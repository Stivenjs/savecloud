//! Sincronización manual de fuentes remotas (HTTP en paralelo, Scrapling limitado).

use std::collections::HashSet;
use std::sync::Arc;

use reqwest::header::{ETAG, LAST_MODIFIED};
use tauri::AppHandle;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::super::fetch::{
    content_hash, extract_header_value, fetch_catalog_via_http, run_scrapling_fetch,
    FetchedCatalogBody, HttpFetchOutcome,
};
use super::super::match_index::invalidate_index;
use crate::sources::domain::{
    ImportMode, RemoteSourceConfig, RemoteSyncItemResult, RemoteSyncResult, SourceCatalog,
};
use crate::sources::parser::parse_catalog_from_reader;
use crate::sources::queue::now_iso;
use crate::sources::store;

/// Peticiones HTTP concurrentes (solo red; bajo uso de CPU/RAM).
const MAX_CONCURRENT_HTTP: usize = 8;
/// Navegadores Scrapling a la vez.
const MAX_CONCURRENT_SCRAPLING: usize = 2;

struct SyncCounters {
    updated: usize,
    unchanged: usize,
    failed: usize,
}

impl SyncCounters {
    fn record_failure(
        &mut self,
        remote_source: &mut RemoteSourceConfig,
        items: &mut Vec<RemoteSyncItemResult>,
        message: String,
    ) {
        self.failed += 1;
        remote_source.sync.sync_error = Some(message.clone());
        items.push(failed_item(remote_source, message));
    }

    fn record_unchanged(
        &mut self,
        remote_source: &mut RemoteSourceConfig,
        items: &mut Vec<RemoteSyncItemResult>,
    ) {
        self.unchanged += 1;
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
    }
}

enum FetchPhaseResult {
    NotModified,
    Body(FetchedCatalogBody),
    NeedsScrapling {
        headers: reqwest::header::HeaderMap,
        url: String,
    },
    Failed(String),
}

fn failed_item(remote_source: &RemoteSourceConfig, message: String) -> RemoteSyncItemResult {
    RemoteSyncItemResult {
        source_id: remote_source.id.clone(),
        url: remote_source.url.clone(),
        success: false,
        updated: false,
        catalog_id: None,
        catalog_name: None,
        error: Some(message),
    }
}

fn updated_item(remote_source: &RemoteSourceConfig, saved: &SourceCatalog) -> RemoteSyncItemResult {
    RemoteSyncItemResult {
        source_id: remote_source.id.clone(),
        url: remote_source.url.clone(),
        success: true,
        updated: true,
        catalog_id: Some(saved.id.clone()),
        catalog_name: Some(saved.name.clone()),
        error: None,
    }
}

fn apply_response_headers(
    remote_source: &mut RemoteSourceConfig,
    headers: &reqwest::header::HeaderMap,
) {
    let etag = extract_header_value(headers, ETAG);
    let last_modified = extract_header_value(headers, LAST_MODIFIED);
    remote_source.sync.etag = etag.or_else(|| remote_source.sync.etag.clone());
    remote_source.sync.last_modified =
        last_modified.or_else(|| remote_source.sync.last_modified.clone());
}

fn catalog_urls_present(sources: &[SourceCatalog]) -> HashSet<String> {
    sources
        .iter()
        .filter_map(|catalog| catalog.source_url.clone())
        .collect()
}

/// Persiste el cuerpo descargado en `sources.json` si cambió o faltaba localmente.
fn persist_catalog_body(
    remote_source: &mut RemoteSourceConfig,
    fetched: FetchedCatalogBody,
    known_catalog_urls: &mut HashSet<String>,
    counters: &mut SyncCounters,
    items: &mut Vec<RemoteSyncItemResult>,
) {
    let hash = content_hash(&fetched.raw);
    let hash_unchanged = remote_source.sync.content_hash.as_deref() == Some(hash.as_str());
    let catalog_missing = !known_catalog_urls.contains(&remote_source.url);

    apply_response_headers(remote_source, &fetched.headers);
    remote_source.sync.last_checked_at = Some(now_iso());
    remote_source.sync.sync_error = None;

    if hash_unchanged && !catalog_missing {
        counters.record_unchanged(remote_source, items);
        return;
    }

    let mut catalog =
        match parse_catalog_from_reader(fetched.raw.as_bytes(), Some(remote_source.url.clone())) {
            Ok(catalog) => catalog,
            Err(error) => {
                log::warn!(
                    "[sources] Error al parsear catálogo de '{}': {}",
                    remote_source.url,
                    error
                );
                counters.record_failure(remote_source, items, error);
                return;
            }
        };

    let total_items = catalog.downloads.len();
    let previous_hash = remote_source.sync.content_hash.clone();
    let previous_synced_at = remote_source.sync.last_synced_at.clone();
    remote_source.sync.content_hash = Some(hash);
    remote_source.sync.last_synced_at = Some(now_iso());
    catalog.sync = Some(remote_source.sync.clone());

    match store::upsert_catalog(catalog, ImportMode::Merge) {
        Ok(saved) => {
            log::info!(
                "[sources] Catálogo '{}' guardado en SQLite con éxito ({} juegos)",
                saved.name,
                total_items
            );
            known_catalog_urls.insert(remote_source.url.clone());
            counters.updated += 1;
            items.push(updated_item(remote_source, &saved));
        }
        Err(error) => {
            log::error!(
                "[sources] Error al guardar catálogo de '{}' en SQLite: {}",
                remote_source.url,
                error
            );
            remote_source.sync.content_hash = previous_hash;
            remote_source.sync.last_synced_at = previous_synced_at;
            counters.record_failure(remote_source, items, error);
        }
    }
}

async fn fetch_phase(
    url: String,
    sync: crate::sources::domain::SourceSyncMetadata,
    repair_missing_catalog: bool,
    http_sem: Arc<Semaphore>,
) -> FetchPhaseResult {
    let _permit = match http_sem.acquire().await {
        Ok(permit) => permit,
        Err(_) => {
            return FetchPhaseResult::Failed(
                "No se pudo reservar slot para descarga HTTP".to_string(),
            );
        }
    };

    match fetch_catalog_via_http(&url, &sync, repair_missing_catalog).await {
        HttpFetchOutcome::NotModified => FetchPhaseResult::NotModified,
        HttpFetchOutcome::Body(body) => FetchPhaseResult::Body(body),
        HttpFetchOutcome::NeedsScrapling { headers, .. } => {
            FetchPhaseResult::NeedsScrapling { headers, url }
        }
        HttpFetchOutcome::Failed(message) => FetchPhaseResult::Failed(message),
    }
}

async fn scrapling_phase(
    app: AppHandle,
    url: String,
    headers: reqwest::header::HeaderMap,
    scrapling_sem: Arc<Semaphore>,
) -> Result<FetchedCatalogBody, String> {
    let _permit = scrapling_sem
        .acquire()
        .await
        .map_err(|_| "No se pudo reservar slot para Scrapling".to_string())?;

    let app_for_blocking = app.clone();
    let url_for_blocking = url.clone();
    let raw = tokio::task::spawn_blocking(move || {
        run_scrapling_fetch(&app_for_blocking, &url_for_blocking, None)
    })
    .await
    .map_err(|error| format!("Scrapling interrumpido: {error}"))??;

    Ok(FetchedCatalogBody { raw, headers })
}

/// Sincroniza fuentes remotas con detección de cambios por cabeceras y hash de contenido.
#[tauri::command]
pub async fn sync_remote_sources(
    app: AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<RemoteSyncResult, String> {
    let selected_ids: Option<HashSet<String>> = source_ids.map(|ids| ids.into_iter().collect());
    let mut remote_sources = store::load_remote_sources()?;
    let mut known_catalog_urls = catalog_urls_present(&store::load_sources()?);

    let sync_indices: Vec<usize> = remote_sources
        .iter()
        .enumerate()
        .filter(|(_, source)| {
            selected_ids
                .as_ref()
                .map(|ids| ids.contains(&source.id))
                .unwrap_or(source.enabled)
        })
        .map(|(index, _)| index)
        .collect();

    let total = sync_indices.len();
    let mut counters = SyncCounters {
        updated: 0,
        unchanged: 0,
        failed: 0,
    };
    let mut items: Vec<RemoteSyncItemResult> = Vec::new();

    if total == 0 {
        return Ok(RemoteSyncResult {
            total: 0,
            updated: 0,
            unchanged: 0,
            failed: 0,
            items,
        });
    }

    let http_sem = Arc::new(Semaphore::new(MAX_CONCURRENT_HTTP));
    let mut fetch_tasks = JoinSet::new();

    for index in &sync_indices {
        let index = *index;
        let url = remote_sources[index].url.clone();
        let sync = remote_sources[index].sync.clone();
        let repair_missing = !known_catalog_urls.contains(&url);
        let sem = Arc::clone(&http_sem);

        fetch_tasks.spawn(async move {
            let outcome = fetch_phase(url, sync, repair_missing, sem).await;
            (index, outcome)
        });
    }

    let mut scrapling_jobs: Vec<(usize, String, reqwest::header::HeaderMap)> = Vec::new();
    let mut processed_indices: HashSet<usize> = HashSet::with_capacity(total);

    while let Some(joined) = fetch_tasks.join_next().await {
        match joined {
            Ok((index, outcome)) => match outcome {
                FetchPhaseResult::NeedsScrapling { headers, url } => {
                    scrapling_jobs.push((index, url, headers));
                }
                FetchPhaseResult::Body(body) => {
                    processed_indices.insert(index);
                    persist_catalog_body(
                        &mut remote_sources[index],
                        body,
                        &mut known_catalog_urls,
                        &mut counters,
                        &mut items,
                    );
                    let _ = store::save_remote_sources(&remote_sources);
                }
                FetchPhaseResult::NotModified => {
                    processed_indices.insert(index);
                    remote_sources[index].sync.last_checked_at = Some(now_iso());
                    counters.record_unchanged(&mut remote_sources[index], &mut items);
                    let _ = store::save_remote_sources(&remote_sources);
                }
                FetchPhaseResult::Failed(message) => {
                    processed_indices.insert(index);
                    remote_sources[index].sync.last_checked_at = Some(now_iso());
                    counters.record_failure(&mut remote_sources[index], &mut items, message);
                    let _ = store::save_remote_sources(&remote_sources);
                }
            },
            Err(error) => {
                log::warn!("[sources] Tarea de fetch remoto falló: {error}");
            }
        }
    }

    if !scrapling_jobs.is_empty() {
        let scrapling_sem = Arc::new(Semaphore::new(MAX_CONCURRENT_SCRAPLING));
        let mut scrapling_tasks = JoinSet::new();

        for (index, url, headers) in scrapling_jobs {
            let app_clone = app.clone();
            let sem = Arc::clone(&scrapling_sem);
            scrapling_tasks.spawn(async move {
                let result = scrapling_phase(app_clone, url, headers, sem).await;
                (index, result)
            });
        }

        while let Some(joined) = scrapling_tasks.join_next().await {
            match joined {
                Ok((index, Ok(body))) => {
                    processed_indices.insert(index);
                    persist_catalog_body(
                        &mut remote_sources[index],
                        body,
                        &mut known_catalog_urls,
                        &mut counters,
                        &mut items,
                    );
                    let _ = store::save_remote_sources(&remote_sources);
                }
                Ok((index, Err(message))) => {
                    processed_indices.insert(index);
                    remote_sources[index].sync.last_checked_at = Some(now_iso());
                    counters.record_failure(&mut remote_sources[index], &mut items, message);
                    let _ = store::save_remote_sources(&remote_sources);
                }
                Err(error) => {
                    log::warn!("[sources] Tarea de Scrapling falló: {error}");
                }
            }
        }
    }

    for index in sync_indices {
        if !processed_indices.contains(&index) {
            remote_sources[index].sync.last_checked_at = Some(now_iso());
            counters.record_failure(
                &mut remote_sources[index],
                &mut items,
                "La descarga no devolvió resultado".to_string(),
            );
        }
    }

    invalidate_index();
    crate::sources::events::emit_catalog_updated(&app);

    let _ = store::save_remote_sources(&remote_sources);

    log::info!(
        "[sources] Sincronización finalizada exitosamente: {} actualizados, {} sin cambios, {} fallidos (total: {})",
        counters.updated,
        counters.unchanged,
        counters.failed,
        total
    );

    Ok(RemoteSyncResult {
        total,
        updated: counters.updated,
        unchanged: counters.unchanged,
        failed: counters.failed,
        items,
    })
}
