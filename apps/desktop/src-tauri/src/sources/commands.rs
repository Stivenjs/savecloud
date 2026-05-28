//! Comandos Tauri del módulo de fuentes.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;
use rayon::prelude::*;
use reqwest::header::{CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use sha2::{Digest, Sha256};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use url::Url;

use crate::network::API_CLIENT;

use super::domain::{
    BatchImportItemResult, BatchImportResult, DownloadProtocol, ImportMode, RemoteSourceConfig,
    RemoteSyncItemResult, RemoteSyncResult, SourceCatalogSummary, SourceDownloadJob,
    SourceItemsPage, SourceJobStatus, SourceSyncMetadata,
};
use super::parser::parse_catalog;
use super::queue::{new_job_id, now_iso, spawn_job, SourcesState};
use super::store;

use super::matcher::{
    find_best_per_source, fnv1a, normalize_title, tokenize_sorted_filtered, IndexEntry,
    MatchConfig, SourceBestMatch,
};

type IndexedSourceItem = IndexEntry;

static INDEX_CACHE: Lazy<Arc<RwLock<Option<Arc<Vec<IndexedSourceItem>>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

static MATCH_CONFIG: Lazy<Arc<RwLock<Option<MatchConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// Carga un archivo de stopwords y calcula los hashes de sus tokens.
///
/// # Arguments
///
/// * `path` - Ruta al archivo `stopwords.json`.
///
/// # Returns
///
/// Un vector con los hashes únicos de las stopwords.
///
/// # Errors
///
/// Devuelve un error si no se puede leer el archivo en disco o si el formato JSON es inválido.
pub fn load_stopwords() -> Result<Vec<u64>, String> {
    let raw = include_str!("./stopwords.json");

    let words: Vec<String> =
        serde_json::from_str(raw).map_err(|e| format!("stopwords.json inválido: {e}"))?;

    let mut hashes: Vec<u64> = words.iter().map(|w| fnv1a(&normalize_title(w))).collect();
    hashes.sort_unstable();
    hashes.dedup();

    Ok(hashes)
}

/// Inicializa la configuración global para el emparejamiento de títulos.
///
/// # Arguments
///
/// * `stopwords_path` - Ruta al archivo JSON con las stopwords.
/// * `threshold` - Límite de similitud base para considerar un match válido.
///
/// # Errors
///
/// Falla si ocurre un problema al cargar el archivo de stopwords a través de [`load_stopwords`].
pub fn init_match_config(threshold: f32) -> Result<(), String> {
    let stopwords = load_stopwords()?;
    let config = MatchConfig {
        threshold,
        stopwords,
    };
    if let Ok(mut guard) = MATCH_CONFIG.write() {
        *guard = Some(config);
    }
    Ok(())
}

/// Devuelve la configuración activa, aplicando un override de threshold si se proporciona.
///
/// Si `init_match_config` aún no fue llamado, usa valores predeterminados seguros.
///
/// # Arguments
///
/// * `threshold_override` - Valor opcional para sobreescribir el límite de similitud actual.
///
/// # Returns
///
/// Una estructura `MatchConfig` lista para ser usada.
fn get_match_config(threshold_override: Option<f32>) -> MatchConfig {
    let base = MATCH_CONFIG
        .read()
        .ok()
        .and_then(|g| g.as_ref().cloned())
        .unwrap_or_else(|| MatchConfig {
            threshold: 0.58,
            stopwords: vec![],
        });

    match threshold_override {
        Some(t) => MatchConfig {
            threshold: t,
            ..base
        },
        None => base,
    }
}

/// Invalida el índice en memoria, forzando su reconstrucción en la próxima búsqueda.
///
/// Debe llamarse cada vez que el conjunto de catálogos cambie (al importar o eliminar fuentes).
fn invalidate_index() {
    if let Ok(mut guard) = INDEX_CACHE.write() {
        *guard = None;
    }
}

/// Devuelve el índice desde la caché o lo construye si fue invalidado.
///
/// La construcción lee los catálogos una sola vez del disco y pre-computa
/// los hashes de tokens de cada título.
///
/// # Returns
///
/// Una referencia contada atómicamente (`Arc`) al índice cacheado.
///
/// # Errors
///
/// Falla si los locks de concurrencia están envenenados (poisoned) o si `build_match_index` falla.
fn get_or_build_index() -> Result<Arc<Vec<IndexedSourceItem>>, String> {
    // Intento de lectura sin bloquear escritores
    {
        let guard = INDEX_CACHE
            .read()
            .map_err(|_| "Index cache read lock poisoned".to_string())?;
        if let Some(ref idx) = *guard {
            return Ok(Arc::clone(idx));
        }
    }

    // Construcción del índice (una sola lectura de disco)
    let new_index = Arc::new(build_match_index()?);

    // Almacena en caché con bloqueo de escritura
    {
        let mut guard = INDEX_CACHE
            .write()
            .map_err(|_| "Index cache write lock poisoned".to_string())?;
        // Doble check: otro hilo pudo haber construido el índice mientras esperábamos
        if guard.is_none() {
            *guard = Some(Arc::clone(&new_index));
        }
        Ok(Arc::clone(guard.as_ref().unwrap()))
    }
}

/// Recolecta todos los items de las fuentes locales y genera la estructura de indexación.
///
/// # Returns
///
/// Un vector conteniendo los elementos indexados (`IndexedSourceItem`).
///
/// # Errors
///
/// Propaga el error si ocurre un problema al cargar las fuentes con `store::load_sources`.
fn build_match_index() -> Result<Vec<IndexedSourceItem>, String> {
    let config = get_match_config(None);
    let mut out: Vec<IndexedSourceItem> = vec![];

    for source in store::load_sources()? {
        for item in source.downloads {
            let mut protocols: Vec<DownloadProtocol> = vec![];
            for uri in &item.uris {
                if !protocols.contains(&uri.protocol) {
                    protocols.push(uri.protocol.clone());
                }
            }
            let normalized = normalize_title(&item.title);
            let token_hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
            out.push(IndexedSourceItem {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                item_id: item.id,
                item_title: item.title.clone(),
                normalized_title: normalized,
                token_hashes,
                protocols,
                file_size: item.file_size.clone(),
            });
        }
    }
    Ok(out)
}

fn normalize_remote_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("La URL no puede estar vacía".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|e| format!("URL inválida: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Solo se permiten URLs HTTPS para fuentes remotas".to_string());
    }

    Ok(parsed.to_string())
}

fn remote_source_id(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    let hexed = hex::encode(digest);
    format!("remote-{}", &hexed[..12])
}

fn extract_header_value(
    headers: &reqwest::header::HeaderMap,
    key: reqwest::header::HeaderName,
) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

fn content_hash(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

fn looks_like_cloudflare_block(content_type: &str, raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    content_type.contains("text/html")
        || lower.contains("cloudflare")
        || lower.contains("cf-chl")
        || lower.contains("captcha")
        || lower.contains("attention required")
}

fn resolve_scrapling_script(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/scrapling_fetch.py", BaseDirectory::Resource)
        .map_err(|e| format!("No se pudo resolver el script de Scrapling: {e}"))
}

fn find_python_executable() -> Result<(String, Vec<String>), String> {
    let candidates = [
        (std::env::var("PYTHON").ok(), Vec::<String>::new()),
        (Some("python".to_string()), Vec::<String>::new()),
        (Some("python3".to_string()), Vec::<String>::new()),
        (Some("py".to_string()), vec!["-3".to_string()]),
    ];

    for (candidate, args) in candidates {
        if let Some(executable) = candidate {
            if which::which(&executable).is_ok() {
                return Ok((executable, args));
            }
        }
    }

    Err("No se encontró Python en PATH. Instala Python 3.10+ para usar Scrapling.".to_string())
}

fn run_scrapling_fetch(app: &AppHandle, url: &str) -> Result<String, String> {
    let script_path = resolve_scrapling_script(app)?;
    let (python_bin, prefix_args) = find_python_executable()?;
    let script_dir = script_path
        .parent()
        .ok_or_else(|| "No se pudo resolver el directorio del script de Scrapling".to_string())?;

    let output = std::process::Command::new(python_bin)
        .current_dir(script_dir)
        .args(prefix_args)
        .arg(script_path)
        .arg(url)
        .env("PYTHONUNBUFFERED", "1")
        .output()
        .map_err(|e| format!("No se pudo ejecutar Scrapling: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(if details.is_empty() {
            "Scrapling falló sin mensaje de error".to_string()
        } else {
            format!("Scrapling falló: {details}")
        });
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Scrapling devolvió texto no UTF-8: {e}"))
}

/// Lista todas las fuentes de catálogos completas almacenadas localmente.
///
/// # Returns
///
/// Un vector de `SourceCatalog`.
#[tauri::command]
pub async fn list_sources() -> Result<Vec<super::domain::SourceCatalog>, String> {
    store::load_sources()
}

/// Genera un resumen de todas las fuentes instaladas.
///
/// # Returns
///
/// Una lista con un conteo rápido de descargas por catálogo en formato `SourceCatalogSummary`.
#[tauri::command]
pub async fn list_sources_summary() -> Result<Vec<SourceCatalogSummary>, String> {
    let sources = store::load_sources()?;
    Ok(sources
        .into_iter()
        .map(|s| SourceCatalogSummary {
            id: s.id,
            name: s.name,
            source_url: s.source_url,
            imported_at: s.imported_at,
            downloads_count: s.downloads.len(),
        })
        .collect())
}

/// Lista fuentes remotas registradas para sincronización manual.
#[tauri::command]
pub async fn list_remote_sources() -> Result<Vec<RemoteSourceConfig>, String> {
    store::load_remote_sources()
}

/// Crea o actualiza una fuente remota por URL.
#[tauri::command]
pub async fn upsert_remote_source(
    url: String,
    enabled: Option<bool>,
) -> Result<RemoteSourceConfig, String> {
    let normalized = normalize_remote_url(&url)?;
    let mut config = store::load_remote_sources()?
        .into_iter()
        .find(|source| source.url == normalized)
        .unwrap_or(RemoteSourceConfig {
            id: remote_source_id(&normalized),
            url: normalized.clone(),
            enabled: true,
            sync: SourceSyncMetadata::default(),
        });

    config.url = normalized;
    if let Some(next_enabled) = enabled {
        config.enabled = next_enabled;
    }

    store::upsert_remote_source(config)
}

/// Elimina una fuente remota por ID.
#[tauri::command]
pub async fn remove_remote_source(source_id: String) -> Result<(), String> {
    store::remove_remote_source(&source_id)
}

/// Cambia el estado habilitado de una fuente remota.
#[tauri::command]
pub async fn set_remote_source_enabled(
    source_id: String,
    enabled: bool,
) -> Result<RemoteSourceConfig, String> {
    let mut remote_sources = store::load_remote_sources()?;
    let Some(index) = remote_sources
        .iter()
        .position(|source| source.id == source_id)
    else {
        return Err(format!("Fuente remota no encontrada: {source_id}"));
    };

    remote_sources[index].enabled = enabled;
    let updated = remote_sources[index].clone();
    store::save_remote_sources(&remote_sources)?;
    Ok(updated)
}

/// Sincroniza fuentes remotas de forma manual con detección de cambios por headers/hash.
#[tauri::command]
pub async fn sync_remote_sources(
    app: AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<RemoteSyncResult, String> {
    let selected_ids: Option<HashSet<String>> = source_ids.map(|ids| ids.into_iter().collect());
    let mut remote_sources = store::load_remote_sources()?;

    let mut total = 0usize;
    let mut updated = 0usize;
    let mut unchanged = 0usize;
    let mut failed = 0usize;
    let mut items: Vec<RemoteSyncItemResult> = Vec::new();

    for remote_source in &mut remote_sources {
        let should_sync = selected_ids
            .as_ref()
            .map(|ids| ids.contains(&remote_source.id))
            .unwrap_or(remote_source.enabled);
        if !should_sync {
            continue;
        }

        total += 1;
        remote_source.sync.last_checked_at = Some(now_iso());

        let mut request = API_CLIENT.get(&remote_source.url);
        if let Some(etag) = &remote_source.sync.etag {
            request = request.header(IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = &remote_source.sync.last_modified {
            request = request.header(IF_MODIFIED_SINCE, last_modified);
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                failed += 1;
                let message = format!("No se pudo descargar la fuente: {error}");
                remote_source.sync.sync_error = Some(message.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(message),
                });
                continue;
            }
        };

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            let catalog_missing = !store::catalog_exists_for_url(&remote_source.url)?;
            if !catalog_missing {
                unchanged += 1;
                remote_source.sync.sync_error = None;
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: true,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: None,
                });
                continue;
            }

            // Hash/etag en remoto pero catálogo ausente en sources.json: re-descargar sin validadores.
            let response = match API_CLIENT.get(&remote_source.url).send().await {
                Ok(response) => response,
                Err(error) => {
                    failed += 1;
                    let message = format!("No se pudo re-descargar la fuente: {error}");
                    remote_source.sync.sync_error = Some(message.clone());
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: false,
                        updated: false,
                        catalog_id: None,
                        catalog_name: None,
                        error: Some(message),
                    });
                    continue;
                }
            };
            if response.status() == reqwest::StatusCode::NOT_MODIFIED {
                failed += 1;
                let message = format!(
                    "El servidor devolvió 304 para {} pero el catálogo local no existe",
                    remote_source.url
                );
                remote_source.sync.sync_error = Some(message.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(message),
                });
                continue;
            }
            // Sustituir la respuesta 304 y continuar el flujo normal con el cuerpo fresco.
            let status = response.status();
            let headers = response.headers().clone();
            let content_type = extract_header_value(&headers, CONTENT_TYPE)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let mut raw = match response.text().await {
                Ok(raw) => raw,
                Err(error) => {
                    failed += 1;
                    let message = format!("No se pudo leer la respuesta: {error}");
                    remote_source.sync.sync_error = Some(message.clone());
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: false,
                        updated: false,
                        catalog_id: None,
                        catalog_name: None,
                        error: Some(message),
                    });
                    continue;
                }
            };

            let should_attempt_scrapling = !status.is_success()
                && matches!(
                    status,
                    reqwest::StatusCode::FORBIDDEN
                        | reqwest::StatusCode::TOO_MANY_REQUESTS
                        | reqwest::StatusCode::SERVICE_UNAVAILABLE
                );

            if should_attempt_scrapling || looks_like_cloudflare_block(&content_type, &raw) {
                match run_scrapling_fetch(&app, &remote_source.url) {
                    Ok(scraped) => raw = scraped,
                    Err(error) => {
                        failed += 1;
                        remote_source.sync.sync_error = Some(error.clone());
                        items.push(RemoteSyncItemResult {
                            source_id: remote_source.id.clone(),
                            url: remote_source.url.clone(),
                            success: false,
                            updated: false,
                            catalog_id: None,
                            catalog_name: None,
                            error: Some(error),
                        });
                        continue;
                    }
                }
            } else if !status.is_success() {
                failed += 1;
                let message = format!("La URL devolvió estado HTTP {}", status);
                remote_source.sync.sync_error = Some(message.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(message),
                });
                continue;
            }

            let hash = content_hash(&raw);
            let etag = extract_header_value(&headers, ETAG);
            let last_modified = extract_header_value(&headers, LAST_MODIFIED);
            remote_source.sync.etag = etag.or(remote_source.sync.etag.clone());
            remote_source.sync.last_modified =
                last_modified.or(remote_source.sync.last_modified.clone());
            remote_source.sync.sync_error = None;

            let mut catalog = match parse_catalog(&raw, Some(remote_source.url.clone())) {
                Ok(catalog) => catalog,
                Err(error) => {
                    failed += 1;
                    remote_source.sync.sync_error = Some(error.clone());
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: false,
                        updated: false,
                        catalog_id: None,
                        catalog_name: None,
                        error: Some(error),
                    });
                    continue;
                }
            };

            remote_source.sync.content_hash = Some(hash);
            remote_source.sync.last_synced_at = Some(now_iso());
            catalog.sync = Some(remote_source.sync.clone());

            match store::upsert_catalog(catalog, ImportMode::Merge) {
                Ok(saved) => {
                    updated += 1;
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: true,
                        updated: true,
                        catalog_id: Some(saved.id),
                        catalog_name: Some(saved.name),
                        error: None,
                    });
                }
                Err(error) => {
                    failed += 1;
                    remote_source.sync.sync_error = Some(error.clone());
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: false,
                        updated: false,
                        catalog_id: None,
                        catalog_name: None,
                        error: Some(error),
                    });
                }
            }
            continue;
        }

        let status = response.status();
        let headers = response.headers().clone();
        let content_type = extract_header_value(&headers, CONTENT_TYPE)
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mut raw = match response.text().await {
            Ok(raw) => raw,
            Err(error) => {
                failed += 1;
                let message = format!("No se pudo leer la respuesta: {error}");
                remote_source.sync.sync_error = Some(message.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(message),
                });
                continue;
            }
        };

        let should_attempt_scrapling = !status.is_success()
            && matches!(
                status,
                reqwest::StatusCode::FORBIDDEN
                    | reqwest::StatusCode::TOO_MANY_REQUESTS
                    | reqwest::StatusCode::SERVICE_UNAVAILABLE
            );

        if should_attempt_scrapling || looks_like_cloudflare_block(&content_type, &raw) {
            match run_scrapling_fetch(&app, &remote_source.url) {
                Ok(scraped) => raw = scraped,
                Err(error) => {
                    failed += 1;
                    remote_source.sync.sync_error = Some(error.clone());
                    items.push(RemoteSyncItemResult {
                        source_id: remote_source.id.clone(),
                        url: remote_source.url.clone(),
                        success: false,
                        updated: false,
                        catalog_id: None,
                        catalog_name: None,
                        error: Some(error),
                    });
                    continue;
                }
            }
        }

        let hash = content_hash(&raw);
        let etag = extract_header_value(&headers, ETAG);
        let last_modified = extract_header_value(&headers, LAST_MODIFIED);
        let hash_unchanged = remote_source.sync.content_hash.as_deref() == Some(hash.as_str());
        let catalog_missing = !store::catalog_exists_for_url(&remote_source.url)?;

        remote_source.sync.etag = etag.or(remote_source.sync.etag.clone());
        remote_source.sync.last_modified =
            last_modified.or(remote_source.sync.last_modified.clone());
        remote_source.sync.last_checked_at = Some(now_iso());
        remote_source.sync.sync_error = None;

        if hash_unchanged && !catalog_missing {
            unchanged += 1;
            items.push(RemoteSyncItemResult {
                source_id: remote_source.id.clone(),
                url: remote_source.url.clone(),
                success: true,
                updated: false,
                catalog_id: None,
                catalog_name: None,
                error: None,
            });
            continue;
        }

        let mut catalog = match parse_catalog(&raw, Some(remote_source.url.clone())) {
            Ok(catalog) => catalog,
            Err(error) => {
                failed += 1;
                remote_source.sync.sync_error = Some(error.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(error),
                });
                continue;
            }
        };

        let previous_hash = remote_source.sync.content_hash.clone();
        let previous_synced_at = remote_source.sync.last_synced_at.clone();
        remote_source.sync.content_hash = Some(hash.clone());
        remote_source.sync.last_synced_at = Some(now_iso());
        catalog.sync = Some(remote_source.sync.clone());

        match store::upsert_catalog(catalog, ImportMode::Merge) {
            Ok(saved) => {
                updated += 1;
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: true,
                    updated: true,
                    catalog_id: Some(saved.id),
                    catalog_name: Some(saved.name),
                    error: None,
                });
            }
            Err(error) => {
                failed += 1;
                remote_source.sync.content_hash = previous_hash;
                remote_source.sync.last_synced_at = previous_synced_at;
                remote_source.sync.sync_error = Some(error.clone());
                items.push(RemoteSyncItemResult {
                    source_id: remote_source.id.clone(),
                    url: remote_source.url.clone(),
                    success: false,
                    updated: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(error),
                });
            }
        }
    }

    if updated > 0 {
        invalidate_index();
    }

    store::save_remote_sources(&remote_sources)?;

    Ok(RemoteSyncResult {
        total,
        updated,
        unchanged,
        failed,
        items,
    })
}

/// Obtiene una página específica de resultados (items) para un catálogo dado.
///
/// # Arguments
///
/// * `source_id` - Identificador de la fuente a consultar.
/// * `offset` - Posición inicial para la paginación (por defecto `0`).
/// * `limit` - Límite máximo de elementos a devolver (por defecto `50`, se acota entre `1` y `200`).
///
/// # Errors
///
/// Returns an error if no source is found with the provided ID.
#[tauri::command]
pub async fn list_source_items_page(
    source_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<SourceItemsPage, String> {
    let sources = store::load_sources()?;
    let source = sources
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;

    let safe_offset = offset.unwrap_or(0);
    let safe_limit = limit.unwrap_or(50).clamp(1, 200);
    let total = source.downloads.len();
    let items = source
        .downloads
        .into_iter()
        .skip(safe_offset)
        .take(safe_limit)
        .collect();

    Ok(SourceItemsPage {
        source_id: source.id,
        total,
        offset: safe_offset,
        limit: safe_limit,
        items,
    })
}

/// Elimina un catálogo por ID y asegura la limpieza de la caché de índices.
///
/// # Arguments
///
/// * `source_id` - Identificador del catálogo a eliminar del almacenamiento.
#[tauri::command]
pub async fn remove_source(source_id: String) -> Result<(), String> {
    let result = store::remove_catalog(&source_id);
    invalidate_index();
    result
}

/// Importa una fuente única desde un archivo JSON en disco local.
///
/// # Arguments
///
/// * `path` - Ruta absoluta o relativa del archivo JSON.
/// * `mode` - Estrategia de importación (`Merge`, `UpdateOrCreate`, o `Replace`).
///
/// # Returns
///
/// El catálogo final que ha sido persistido exitosamente en disco.
///
/// # Errors
///
/// Si falla la lectura del archivo, el parsing del JSON o la escritura en almacenamiento.
#[tauri::command]
pub async fn import_source_from_file(
    path: String,
    mode: ImportMode,
) -> Result<super::domain::SourceCatalog, String> {
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("No se pudo leer JSON: {e}"))?;
    let catalog = parse_catalog(&raw, Some(format!("file://{path}")))?;
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    Ok(result)
}

/// Importa múltiples fuentes desde archivos JSON de manera concurrente.
///
/// Procesa todos los archivos en tareas paralelas (`tokio::spawn`), acumulando los
/// resultados de éxito/fracaso, e invalida el índice global de búsqueda una sola
/// vez al concluir el proceso total.
///
/// # Arguments
///
/// * `paths` - Vector que contiene las rutas hacia los archivos a importar.
/// * `mode` - Modo de importación que se aplicará sistemáticamente a cada fuente procesada.
///
/// # Returns
///
/// Un objeto `BatchImportResult` detallando qué fuentes se importaron bien y cuáles fallaron.
#[tauri::command]
pub async fn import_sources_from_files_batch(
    paths: Vec<String>,
    mode: ImportMode,
) -> Result<BatchImportResult, String> {
    let total = paths.len();

    let mut parse_tasks = Vec::with_capacity(total);
    for path in paths {
        let task = tokio::spawn(async move {
            let raw = match tokio::fs::read_to_string(&path).await {
                Ok(content) => content,
                Err(e) => return Err((path, format!("No se pudo leer archivo: {e}"))),
            };
            match parse_catalog(&raw, Some(format!("file://{path}"))) {
                Ok(catalog) => Ok((path, catalog)),
                Err(e) => Err((path, format!("JSON inválido: {e}"))),
            }
        });
        parse_tasks.push(task);
    }

    let mut parsed = Vec::new();
    let mut items = Vec::with_capacity(total);
    let mut failed = 0usize;

    for task in parse_tasks {
        match task.await {
            Ok(Ok((path, catalog))) => parsed.push((path, catalog)),
            Ok(Err((path, error))) => {
                failed += 1;
                items.push(BatchImportItemResult {
                    path,
                    success: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(error),
                    was_updated: false,
                });
            }
            Err(e) => {
                failed += 1;
                items.push(BatchImportItemResult {
                    path: "<unknown>".to_string(),
                    success: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(format!("Task panicked: {e}")),
                    was_updated: false,
                });
            }
        }
    }

    let mut succeeded = 0usize;

    for (path, catalog) in parsed {
        let catalog_id = catalog.id.clone();
        let catalog_name = catalog.name.clone();

        let was_updated = match store::load_sources() {
            Ok(sources) => sources.iter().any(|s| match mode {
                ImportMode::Merge => s.id == catalog_id,
                ImportMode::UpdateOrCreate => s.name == catalog_name,
                ImportMode::Replace => false,
            }),
            Err(_) => false,
        };

        match store::upsert_catalog(catalog, mode.clone()) {
            Ok(_) => {
                succeeded += 1;
                items.push(BatchImportItemResult {
                    path,
                    success: true,
                    catalog_id: Some(catalog_id),
                    catalog_name: Some(catalog_name),
                    error: None,
                    was_updated,
                });
            }
            Err(e) => {
                failed += 1;
                items.push(BatchImportItemResult {
                    path,
                    success: false,
                    catalog_id: Some(catalog_id),
                    catalog_name: Some(catalog_name),
                    error: Some(format!("Error al guardar: {e}")),
                    was_updated: false,
                });
            }
        }
    }

    if succeeded > 0 {
        invalidate_index();
    }

    Ok(BatchImportResult {
        total,
        succeeded,
        failed,
        items,
    })
}

/// Descarga e importa una fuente remota a través de una petición HTTP.
///
/// Si la URL indica una página HTML de error de Cloudflare en vez de JSON limpio,
/// la operación abortará de forma segura y devolverá un error.
///
/// # Arguments
///
/// * `url` - El origen web de los datos de catálogo.
/// * `mode` - La forma en que debe mezclarse o reemplazarse la información previa.
///
/// # Errors
///
/// Retorna error ante fallos de red (`reqwest`), status HTTP erróneos o bloqueos anti-bot.
#[tauri::command]
pub async fn import_source_from_url(
    app: AppHandle,
    url: String,
    mode: ImportMode,
) -> Result<super::domain::SourceCatalog, String> {
    let response = API_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la fuente: {e}"))?;
    let status = response.status();
    let headers = response.headers().clone();
    let content_type = extract_header_value(&headers, CONTENT_TYPE)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut raw = response
        .text()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta: {e}"))?;
    let should_attempt_scrapling = !status.is_success()
        && matches!(
            status,
            reqwest::StatusCode::FORBIDDEN
                | reqwest::StatusCode::TOO_MANY_REQUESTS
                | reqwest::StatusCode::SERVICE_UNAVAILABLE
        );
    if should_attempt_scrapling || looks_like_cloudflare_block(&content_type, &raw) {
        raw = run_scrapling_fetch(&app, &url)?;
    } else if !status.is_success() {
        return Err(format!("La URL devolvió estado HTTP {}", status));
    }

    let mut catalog = parse_catalog(&raw, Some(url))?;
    catalog.sync = Some(SourceSyncMetadata {
        etag: extract_header_value(&headers, ETAG),
        last_modified: extract_header_value(&headers, LAST_MODIFIED),
        content_hash: Some(content_hash(&raw)),
        last_checked_at: Some(now_iso()),
        last_synced_at: Some(now_iso()),
        sync_error: None,
    });
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    Ok(result)
}

/// Busca las mejores coincidencias a lo largo de todos los catálogos para un título concreto.
///
/// Este motor de indexado garantiza como máximo un resultado (`SourceBestMatch`) por catálogo instalado.
///
/// # Arguments
///
/// * `game_name` - Cadena de texto origen introducida por el usuario a buscar.
/// * `threshold` - Porcentaje opcional de exactitud para los tokens admitidos.
///
/// # Returns
///
/// Un vector plano con los mejores "matches" listados para cada fuente.
#[tauri::command]
pub async fn sources_find_match_for_game(
    game_name: String,
    threshold: Option<f32>,
) -> Result<Vec<SourceBestMatch>, String> {
    let index = get_or_build_index()?;
    let config = get_match_config(threshold);
    let normalized = normalize_title(&game_name);
    let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);

    Ok(find_best_per_source(
        &game_name,
        &normalized,
        &hashes,
        &config,
        &index,
    ))
}

/// Evalúa un listado de múltiples títulos de forma concurrente buscando el mejor "match" por fuente.
///
/// Evita relecturas forzando el mismo índice cacheado para todos los procesos. El orden de salida
/// corresponde estrictamente al orden de las queries solicitadas.
///
/// # Arguments
///
/// * `game_names` - Vector con los diferentes títulos objetivo a encontrar simultáneamente.
/// * `threshold` - Sensibilidad general opcional a inyectar al comparador de textos.
///
/// # Returns
///
/// Tuplas estructuradas asociando cada título evaluado junto con su matriz de `SourceBestMatch`.
#[tauri::command]
pub async fn sources_find_matches_batch(
    game_names: Vec<String>,
    threshold: Option<f32>,
) -> Result<Vec<(String, Vec<SourceBestMatch>)>, String> {
    let index = get_or_build_index()?;
    let config = get_match_config(threshold);

    let results: Vec<(String, Vec<SourceBestMatch>)> = game_names
        .par_iter()
        .map(|name| {
            let normalized = normalize_title(name);
            let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
            let matches = find_best_per_source(name, &normalized, &hashes, &config, &index);
            (name.clone(), matches)
        })
        .collect();

    Ok(results)
}

/// Recupera del estado global de Tauri la lista actual de tareas de descarga.
///
/// # Arguments
///
/// * `state` - Manager de contexto con `SourcesState` inyectado automáticamente.
///
/// # Returns
///
/// Vector representando un snapshot del estado `SourceDownloadJob` listado en sistema.
#[tauri::command]
pub async fn list_source_download_jobs(
    state: tauri::State<'_, SourcesState>,
) -> Result<Vec<SourceDownloadJob>, String> {
    Ok(state.list_jobs())
}

/// Empaqueta una petición de descarga y la encola como tarea activa en el manejador local.
///
/// Elige inteligentemente el protocolo óptimo a servir (P2P vs HTTP) en función
/// de las opciones empaquetadas por la fuente, o forzado por `preferred_protocol`.
///
/// # Arguments
///
/// * `source_id` - Catálogo matriz donde localizar el objeto virtual de descarga.
/// * `item_id` - ID específico del paquete virtual.
/// * `destination_dir` - Directorio base donde aterrizará la persistencia final.
/// * `preferred_protocol` - Intento de sobreescribir la opción de URI (`Torrent` vs `HTTP`).
/// * `app` - Handle puente con el emisor global Tauri de eventos.
/// * `state` - Contexto inyectado en ejecución con la cola en memoria RAM.
///
/// # Returns
///
/// El Hash/UUID alfanumérico generado aleatoriamente en el momento asignado para seguir este job.
///
/// # Errors
///
/// Produce error si no encuentra la fuente nativa, el paquete sub-id o no contiene URIs admitidas.
#[tauri::command]
pub async fn start_source_download(
    source_id: String,
    item_id: String,
    destination_dir: String,
    preferred_protocol: Option<DownloadProtocol>,
    app: AppHandle,
    state: tauri::State<'_, SourcesState>,
) -> Result<String, String> {
    let sources = store::load_sources()?;
    let source = sources
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;
    let item = source
        .downloads
        .iter()
        .find(|s| s.id == item_id)
        .ok_or_else(|| format!("Item no encontrado: {item_id}"))?;

    // Selecciona la URI según protocolo preferido; si no hay preferencia,
    // prioriza torrent sobre HTTP. Para HTTP, la primera URI del fallback global (prioridad JSON).
    let selected = if let Some(pref) = preferred_protocol {
        item.uris
            .iter()
            .find(|u| u.protocol == pref)
            .cloned()
            .or_else(|| item.uris.first().cloned())
    } else {
        item.uris
            .iter()
            .find(|u| {
                matches!(
                    u.protocol,
                    DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
                )
            })
            .cloned()
            .or_else(|| {
                item.uris
                    .iter()
                    .find(|u| u.protocol == DownloadProtocol::Http)
                    .cloned()
            })
            .or_else(|| item.uris.first().cloned())
    }
    .ok_or_else(|| "No hay URIs válidas para descargar".to_string())?;

    let job_id = new_job_id();
    let now = now_iso();
    let job = SourceDownloadJob {
        job_id: job_id.clone(),
        source_id: source_id.clone(),
        item_id: item_id.clone(),
        title: item.title.clone(),
        destination_dir,
        selected_uri: selected.uri,
        protocol: selected.protocol,
        status: SourceJobStatus::Queued,
        loaded: 0,
        total: 0,
        download_speed_bytes: 0,
        eta_seconds: None,
        error: None,
        external_id: None,
        output_file_name: None,
        created_at: now.clone(),
        updated_at: now,
    };

    state.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    spawn_job(app, job_id.clone());
    Ok(job_id)
}

/// Corta de raíz la ejecución en progreso y emite eventos globales de terminación por cliente.
///
/// Desencadena rutinas de limpieza como detener sesiones en P2P y borrar del disco los archivos
/// incompletos si se trata de un stream web puro.
///
/// # Arguments
///
/// * `job_id` - Identidad asignada y registrada del Job a detener y catalogar como abortado.
/// * `state` - Árbol de contexto general para persistir flags del estado alterado a `Cancelled`.
/// * `app` - Handle interno para disparar `TORRENT_CANCELLED_EVENT` en IPC al front-end.
///
/// # Errors
///
/// Fallará exclusivamente si intenta cancelarse una tarea huérfana (inexistente dentro del `state`).
#[tauri::command]
pub async fn cancel_source_download(
    job_id: String,
    state: tauri::State<'_, super::queue::SourcesState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut job = state
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if matches!(
        job.status,
        SourceJobStatus::Completed | SourceJobStatus::Cancelled | SourceJobStatus::Failed
    ) {
        return Ok(());
    }

    match job.protocol {
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile => {
            if let Some(info_hash) = job.external_id.clone() {
                let torrent_state = app.state::<crate::torrent::state::TorrentState>();
                let session = {
                    let mut engine = torrent_state.engine.lock().await;
                    engine.unregister_active(&info_hash);
                    engine.session()
                };

                let info_hash_clone = info_hash.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::torrent::engine::cancel_via_session(&session, &info_hash_clone)
                        .await;
                });

                let _ = app.emit(crate::torrent::engine::TORRENT_CANCELLED_EVENT, &info_hash);
            }
        }
        DownloadProtocol::Http => {
            if let Some(ref name) = job.output_file_name {
                let path = std::path::PathBuf::from(&job.destination_dir).join(name);
                let _ = tokio::fs::remove_file(path).await;
            }
        }
        _ => {}
    }

    job.status = SourceJobStatus::Cancelled;
    job.updated_at = super::queue::now_iso();
    job.error = None;
    state.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    super::events::emit_terminal(&app, &job);
    super::queue::cancel_job(&state, &job_id);
    state.remove_job(&job_id)?;
    Ok(())
}

/// Congela momentáneamente el flujo de paquetes de descarga sobre P2P sin cancelar la tarea real.
///
/// Las descargas HTTP no admiten pausa; use cancelar en su lugar.
///
/// # Arguments
///
/// * `job_id` - Identificación rastreable local del paquete torrent bajo control de sesión.
/// * `app` - `AppHandle` portando los estados para comunicarse cruzado con el `torrent_engine`.
///
/// # Errors
///
/// Si el `job_id` rastreable pierde validez u orfandad con la RAM.
#[tauri::command]
pub async fn pause_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<super::queue::SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if job.protocol == DownloadProtocol::Http {
        return Err("Las descargas HTTP no se pueden pausar. Usa cancelar.".to_string());
    }

    match job.protocol {
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile => {
            if let Some(info_hash) = job.external_id.clone() {
                let torrent_state = app.state::<crate::torrent::state::TorrentState>();
                let session = {
                    let engine = torrent_state.engine.lock().await;
                    engine.session()
                };

                let info_hash_clone = info_hash.clone();
                tauri::async_runtime::spawn(async move {
                    let _ =
                        crate::torrent::engine::pause_via_session(&session, &info_hash_clone).await;
                });
            }
        }
        _ => {}
    }

    job.status = SourceJobStatus::Paused;
    job.updated_at = super::queue::now_iso();
    sources.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    Ok(())
}

/// Resucita y relanza un subproceso de sesión detenido a su curso normal.
///
/// Evaluará primero si la sesión de C++ en memoria está fresca y reanudable para reconexión exprés.
/// De no ser posible por limpieza global (reinicio de Tauri), lanza un worker nuevo delegándolo al stack de colas original.
///
/// # Arguments
///
/// * `job_id` - Instancia pausada en lista de espera.
/// * `app` - Acceso a utilidades `spawn_job` o puentes `TorrentState`.
///
/// # Errors
///
/// Si el `job_id` está ausente de la colección compartida `SourcesState`.
#[tauri::command]
pub async fn resume_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<super::queue::SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if job.protocol == DownloadProtocol::Http {
        return Err(
            "Las descargas HTTP no se pueden reanudar. Inicia la descarga de nuevo.".to_string(),
        );
    }

    job.status = SourceJobStatus::Queued;
    job.updated_at = super::queue::now_iso();
    sources.upsert_job(job.clone())?;

    let is_torrent = matches!(
        job.protocol,
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
    );
    let mut resumed_via_session = false;

    // Si es torrent, intentamos reanudar la sesión existente (si la app no se ha cerrado)
    if is_torrent {
        if let Some(info_hash) = &job.external_id {
            let torrent_state = app.state::<crate::torrent::state::TorrentState>();
            let session = {
                let engine = torrent_state.engine.lock().await;
                engine.session()
            };
            if crate::torrent::engine::resume_via_session(&session, info_hash)
                .await
                .is_ok()
            {
                resumed_via_session = true;
                job.status = SourceJobStatus::Running;
                job.updated_at = super::queue::now_iso();
                sources.upsert_job(job.clone())?;
                super::events::emit_progress(&app, &job);
            }
        }
    }

    // Si fue HTTP o si la sesión del torrent expiró (reinicio de app), levantamos un nuevo worker.
    if !resumed_via_session {
        super::queue::spawn_job(app, job_id);
    }

    Ok(())
}
