//! Comandos Tauri del módulo de fuentes.

use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;
use rayon::prelude::*;
use tauri::{AppHandle, Manager};

use crate::network::API_CLIENT;

use super::domain::{
    DownloadProtocol, ImportMode, SourceCatalogSummary, SourceDownloadJob, SourceItemsPage,
    SourceJobStatus, SourceMatchCandidate, SourceMatchResult,
};
use super::parser::parse_catalog;
use super::queue::{cancel_job, new_job_id, now_iso, spawn_job, SourcesState};
use super::store;

/// Entrada del índice de matching almacenada en memoria.
///
/// Los tokens se guardan como hashes FNV-1a (u64) ordenados para que la
/// intersección/unión Jaccard sea O(n+m) con punteros sobre slices.
#[derive(Debug, Clone)]
struct IndexedSourceItem {
    source_id: String,
    source_name: String,
    item_id: String,
    item_title: String,
    /// Título normalizado original (para contains-check rápido).
    normalized_title: String,
    /// Tokens del título como hashes FNV-1a ordenados de menor a mayor.
    token_hashes: Vec<u64>,
    protocols: Vec<DownloadProtocol>,
}

/// Cache global del índice. Se invalida escribiendo `None`.
///
/// Usar `Arc<RwLock<...>>` permite múltiples lectores concurrentes (rayon)
/// sin bloquear, y escritura exclusiva solo cuando el índice se reconstruye.
static INDEX_CACHE: Lazy<Arc<RwLock<Option<Arc<Vec<IndexedSourceItem>>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// Invalida el índice en memoria, forzando su reconstrucción en la próxima búsqueda.
///
/// Debe llamarse cada vez que el conjunto de catálogos cambie
/// (importar, eliminar).
fn invalidate_index() {
    if let Ok(mut guard) = INDEX_CACHE.write() {
        *guard = None;
    }
}

/// Devuelve el índice desde la caché o lo construye si fue invalidado.
///
/// La construcción lee los catálogos una sola vez del disco y pre-computa
/// los hashes de tokens de cada título.
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
        // Si ya fue construido por otro hilo, devolvemos el que ellos pusieron
        return Ok(Arc::clone(guard.as_ref().unwrap()));
    }
}

/// Calcula el hash FNV-1a de 64 bits de un string de tokens.
///
/// FNV-1a es extremadamente rápido y produce poca colisión para palabras
/// cortas como las que conforman títulos de juegos.
#[inline]
fn fnv1a(s: &str) -> u64 {
    const OFFSET: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    let mut hash = OFFSET;
    for byte in s.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Normaliza un título a minúsculas, reemplazando no-alfanuméricos con espacios
/// y colapsando espacios múltiples.
fn normalize_title(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = false;
    for ch in input.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Tokeniza un título normalizado y devuelve sus hashes FNV-1a **ordenados**.
///
/// Ordenar los hashes permite calcular intersección y unión en O(n+m)
/// con dos punteros, sin usar sets ni allocaciones extra.
fn tokenize_sorted(normalized: &str) -> Vec<u64> {
    let mut hashes: Vec<u64> = normalized.split_whitespace().map(fnv1a).collect();
    hashes.sort_unstable();
    hashes.dedup(); // elimina duplicados para Jaccard correcto
    hashes
}

/// Calcula el coeficiente Jaccard entre dos slices de hashes **ordenados**.
///
/// Complejidad: O(n + m) con dos punteros, cero allocaciones.
/// Incluye atajos para igualdad exacta y substring.
#[inline]
fn similarity_score_fast(
    left_norm: &str,
    left_hashes: &[u64],
    right_norm: &str,
    right_hashes: &[u64],
    threshold: f32,
) -> f32 {
    if left_norm.is_empty() || right_norm.is_empty() {
        return 0.0;
    }

    // Igualdad exacta tras normalización
    if left_norm == right_norm {
        return 1.0;
    }

    // Substring rápido (cubre "GTA V" vs "Grand Theft Auto V - GTA V")
    if left_norm.contains(right_norm) || right_norm.contains(left_norm) {
        return 0.96;
    }

    // Early-exit: cota superior de Jaccard antes de calcular la intersección.
    // El máximo Jaccard posible es min(|A|, |B|) / max(|A|, |B|).
    // Si esa cota ya está bajo el umbral, el resultado nunca lo alcanzará.
    let ln = left_hashes.len();
    let rn = right_hashes.len();
    if ln == 0 || rn == 0 {
        return 0.0;
    }
    let upper_bound = ln.min(rn) as f32 / ln.max(rn) as f32;
    if upper_bound < threshold {
        return 0.0;
    }

    // Intersección con dos punteros sobre slices ordenados (O(n+m), sin alloc)
    let mut i = 0usize;
    let mut j = 0usize;
    let mut intersection = 0usize;
    while i < ln && j < rn {
        match left_hashes[i].cmp(&right_hashes[j]) {
            std::cmp::Ordering::Equal => {
                intersection += 1;
                i += 1;
                j += 1;
            }
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
        }
    }

    let union = ln + rn - intersection;
    intersection as f32 / union as f32
}

/// Construye el índice completo de items desde los catálogos en disco.
///
/// Esta función es costosa (lee disco) y solo debe llamarse cuando el índice
/// no está en caché. El resultado se almacena en [`INDEX_CACHE`].
fn build_match_index() -> Result<Vec<IndexedSourceItem>, String> {
    let mut out: Vec<IndexedSourceItem> = vec![];
    for source in store::load_sources()? {
        for item in source.downloads {
            // Deduplica protocolos en una sola pasada
            let mut protocols: Vec<DownloadProtocol> = vec![];
            for uri in &item.uris {
                if !protocols.contains(&uri.protocol) {
                    protocols.push(uri.protocol.clone());
                }
            }
            let normalized = normalize_title(&item.title);
            let token_hashes = tokenize_sorted(&normalized);
            out.push(IndexedSourceItem {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                item_id: item.id,
                item_title: item.title.clone(),
                normalized_title: normalized,
                token_hashes,
                protocols,
            });
        }
    }
    Ok(out)
}

/// Busca los mejores candidatos para un juego dentro del índice proporcionado.
///
/// Devuelve hasta 5 resultados ordenados por score descendente.
/// La función es pura (sin I/O) para poder llamarse en paralelo con rayon.
fn find_matches_from_index(
    game_name: &str,
    normalized_game: &str,
    game_hashes: &[u64],
    threshold: f32,
    index: &[IndexedSourceItem],
) -> SourceMatchResult {
    let mut matches: Vec<SourceMatchCandidate> = Vec::new();

    for item in index {
        let score = similarity_score_fast(
            normalized_game,
            game_hashes,
            &item.normalized_title,
            &item.token_hashes,
            threshold,
        );
        if score >= threshold {
            matches.push(SourceMatchCandidate {
                source_id: item.source_id.clone(),
                source_name: item.source_name.clone(),
                item_id: item.item_id.clone(),
                item_title: item.item_title.clone(),
                score,
                protocols: item.protocols.clone(),
            });
        }
    }

    // Ordena por score descendente y trunca a los 5 mejores
    matches.sort_unstable_by(|a, b| b.score.total_cmp(&a.score));
    matches.truncate(5);

    let best = matches.first().cloned();
    SourceMatchResult {
        game_name: game_name.to_string(),
        best,
        candidates: matches,
    }
}

/// Lista todos los catálogos de fuentes importados.
#[tauri::command]
pub async fn list_sources() -> Result<Vec<super::domain::SourceCatalog>, String> {
    store::load_sources()
}

/// Lista catálogos en modo resumen para evitar cargas pesadas en la UI.
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

/// Devuelve una página de items de un catálogo para evitar freezes de UI.
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

/// Elimina un catálogo por ID e invalida el índice en memoria.
#[tauri::command]
pub async fn remove_source(source_id: String) -> Result<(), String> {
    let result = store::remove_catalog(&source_id);
    // El índice debe regenerarse sin el catálogo eliminado
    invalidate_index();
    result
}

/// Importa una fuente desde un archivo JSON local e invalida el índice.
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
    // Nuevo catálogo disponible: fuerza reconstrucción del índice
    invalidate_index();
    Ok(result)
}

/// Importa una fuente desde una URL JSON remota e invalida el índice.
#[tauri::command]
pub async fn import_source_from_url(
    url: String,
    mode: ImportMode,
) -> Result<super::domain::SourceCatalog, String> {
    let response = API_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la fuente: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("La URL devolvió estado HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta: {e}"))?;
    let lower = raw.to_ascii_lowercase();
    let looks_like_cloudflare_block = content_type.contains("text/html")
        || lower.contains("cloudflare")
        || lower.contains("cf-chl")
        || lower.contains("captcha")
        || lower.contains("attention required");
    if looks_like_cloudflare_block {
        return Err(
            "La URL está protegida por Cloudflare/CAPTCHA y no permite importación automática. \
             Descarga el JSON manualmente e impórtalo por archivo."
                .to_string(),
        );
    }
    let catalog = parse_catalog(&raw, Some(url))?;
    let result = store::upsert_catalog(catalog, mode)?;
    // Nuevo catálogo disponible: fuerza reconstrucción del índice
    invalidate_index();
    Ok(result)
}

/// Busca el mejor match para un juego contra las fuentes importadas.
///
/// Usa el índice cacheado en memoria; si fue invalidado, lo reconstruye
/// una sola vez antes de buscar.
#[tauri::command]
pub async fn sources_find_match_for_game(
    game_name: String,
    threshold: Option<f32>,
) -> Result<SourceMatchResult, String> {
    let index = get_or_build_index()?;
    let normalized_game = normalize_title(&game_name);
    let game_hashes = tokenize_sorted(&normalized_game);
    let score_threshold = threshold.unwrap_or(0.58);
    Ok(find_matches_from_index(
        &game_name,
        &normalized_game,
        &game_hashes,
        score_threshold,
        &index,
    ))
}

/// Busca matches para una lista de juegos en paralelo usando rayon.
///
/// Todos los juegos comparten el mismo índice cacheado (lectura concurrente
/// sin bloqueo). El resultado conserva el orden de entrada.
#[tauri::command]
pub async fn sources_find_matches_batch(
    game_names: Vec<String>,
    threshold: Option<f32>,
) -> Result<Vec<SourceMatchResult>, String> {
    // Construir (o reutilizar) el índice fuera del par_iter para no
    // intentar I/O desde múltiples hilos rayon simultáneamente
    let index = get_or_build_index()?;
    let score_threshold = threshold.unwrap_or(0.58);

    // rayon procesa todos los juegos en paralelo sobre el mismo Arc<Vec<...>>
    let results: Vec<SourceMatchResult> = game_names
        .par_iter()
        .map(|name| {
            let normalized = normalize_title(name);
            let hashes = tokenize_sorted(&normalized);
            find_matches_from_index(name, &normalized, &hashes, score_threshold, &index)
        })
        .collect();

    Ok(results)
}

/// Lista los jobs activos del motor de fuentes.
#[tauri::command]
pub async fn list_source_download_jobs(
    state: tauri::State<'_, SourcesState>,
) -> Result<Vec<SourceDownloadJob>, String> {
    Ok(state.list_jobs())
}

/// Encola e inicia un job de descarga para un item de fuente.
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
    // prioriza torrent sobre HTTP y cae en la primera disponible.
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
        error: None,
        external_id: None,
        created_at: now.clone(),
        updated_at: now,
    };

    state.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    spawn_job(app, job_id.clone());
    Ok(job_id)
}

/// Solicita la cancelación de un job en curso.
#[tauri::command]
pub async fn cancel_source_download(
    job_id: String,
    state: tauri::State<'_, SourcesState>,
) -> Result<(), String> {
    cancel_job(&state, &job_id);
    Ok(())
}

/// Pausa un job torrent activo enviando la señal al motor de torrents.
#[tauri::command]
pub async fn pause_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;
    let Some(info_hash) = job.external_id.clone() else {
        return Err("El job no tiene info_hash activo".to_string());
    };
    let torrent_state = app.state::<crate::torrent::state::TorrentState>();
    let session = {
        let engine = torrent_state.engine.lock().await;
        engine.session()
    };
    crate::torrent::engine::pause_via_session(&session, &info_hash)
        .await
        .map_err(|e| e.to_string())?;
    job.status = SourceJobStatus::Paused;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    Ok(())
}

/// Reanuda un job torrent previamente pausado.
#[tauri::command]
pub async fn resume_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;
    let Some(info_hash) = job.external_id.clone() else {
        return Err("El job no tiene info_hash activo".to_string());
    };
    let torrent_state = app.state::<crate::torrent::state::TorrentState>();
    let session = {
        let engine = torrent_state.engine.lock().await;
        engine.session()
    };
    crate::torrent::engine::resume_via_session(&session, &info_hash)
        .await
        .map_err(|e| e.to_string())?;
    job.status = SourceJobStatus::Running;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    Ok(())
}
