//! Sincronización manual de fuentes remotas.

use std::collections::HashSet;

use reqwest::header::{ETAG, LAST_MODIFIED};
use reqwest::StatusCode;
use tauri::AppHandle;

use super::super::fetch::{
    content_hash, extract_header_value, fetch_fresh, fetch_with_validators, read_catalog_body,
    FetchedCatalogBody,
};
use super::super::match_index::invalidate_index;
use crate::sources::domain::{
    ImportMode, RemoteSourceConfig, RemoteSyncItemResult, RemoteSyncResult, SourceCatalog,
};
use crate::sources::parser::parse_catalog;
use crate::sources::queue::now_iso;
use crate::sources::store;

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

fn apply_response_headers(remote_source: &mut RemoteSourceConfig, headers: &reqwest::header::HeaderMap) {
    let etag = extract_header_value(headers, ETAG);
    let last_modified = extract_header_value(headers, LAST_MODIFIED);
    remote_source.sync.etag = etag.or_else(|| remote_source.sync.etag.clone());
    remote_source.sync.last_modified = last_modified.or_else(|| remote_source.sync.last_modified.clone());
}

/// Persiste el cuerpo descargado en `sources.json` si cambió o faltaba localmente.
fn persist_catalog_body(
    remote_source: &mut RemoteSourceConfig,
    fetched: FetchedCatalogBody,
    counters: &mut SyncCounters,
    items: &mut Vec<RemoteSyncItemResult>,
) {
    let hash = content_hash(&fetched.raw);
    let hash_unchanged = remote_source.sync.content_hash.as_deref() == Some(hash.as_str());
    let catalog_missing = match store::catalog_exists_for_url(&remote_source.url) {
        Ok(missing) => !missing,
        Err(error) => {
            counters.record_failure(remote_source, items, error);
            return;
        }
    };

    apply_response_headers(remote_source, &fetched.headers);
    remote_source.sync.last_checked_at = Some(now_iso());
    remote_source.sync.sync_error = None;

    if hash_unchanged && !catalog_missing {
        counters.record_unchanged(remote_source, items);
        return;
    }

    let mut catalog = match parse_catalog(&fetched.raw, Some(remote_source.url.clone())) {
        Ok(catalog) => catalog,
        Err(error) => {
            counters.record_failure(remote_source, items, error);
            return;
        }
    };

    let previous_hash = remote_source.sync.content_hash.clone();
    let previous_synced_at = remote_source.sync.last_synced_at.clone();
    remote_source.sync.content_hash = Some(hash);
    remote_source.sync.last_synced_at = Some(now_iso());
    catalog.sync = Some(remote_source.sync.clone());

    match store::upsert_catalog(catalog, ImportMode::Merge) {
        Ok(saved) => {
            counters.updated += 1;
            items.push(updated_item(remote_source, &saved));
        }
        Err(error) => {
            remote_source.sync.content_hash = previous_hash;
            remote_source.sync.last_synced_at = previous_synced_at;
            counters.record_failure(remote_source, items, error);
        }
    }
}

async fn sync_one_remote_source(
    app: &AppHandle,
    remote_source: &mut RemoteSourceConfig,
    counters: &mut SyncCounters,
    items: &mut Vec<RemoteSyncItemResult>,
) {
    remote_source.sync.last_checked_at = Some(now_iso());

    let response = match fetch_with_validators(&remote_source.url, &remote_source.sync).await {
        Ok(response) => response,
        Err(message) => {
            counters.record_failure(remote_source, items, message);
            return;
        }
    };

    if response.status() == StatusCode::NOT_MODIFIED {
        let catalog_missing = match store::catalog_exists_for_url(&remote_source.url) {
            Ok(exists) => !exists,
            Err(error) => {
                counters.record_failure(remote_source, items, error);
                return;
            }
        };

        if !catalog_missing {
            counters.record_unchanged(remote_source, items);
            return;
        }

        let response = match fetch_fresh(&remote_source.url).await {
            Ok(response) => response,
            Err(message) => {
                counters.record_failure(remote_source, items, message);
                return;
            }
        };

        if response.status() == StatusCode::NOT_MODIFIED {
            counters.record_failure(
                remote_source,
                items,
                format!(
                    "El servidor devolvió 304 para {} pero el catálogo local no existe",
                    remote_source.url
                ),
            );
            return;
        }

        let fetched = match read_catalog_body(app, &remote_source.url, response).await {
            Ok(fetched) => fetched,
            Err(message) => {
                counters.record_failure(remote_source, items, message);
                return;
            }
        };
        persist_catalog_body(remote_source, fetched, counters, items);
        return;
    }

    let fetched = match read_catalog_body(app, &remote_source.url, response).await {
        Ok(fetched) => fetched,
        Err(message) => {
            counters.record_failure(remote_source, items, message);
            return;
        }
    };
    persist_catalog_body(remote_source, fetched, counters, items);
}

/// Sincroniza fuentes remotas con detección de cambios por cabeceras y hash de contenido.
#[tauri::command]
pub async fn sync_remote_sources(
    app: AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<RemoteSyncResult, String> {
    let selected_ids: Option<HashSet<String>> = source_ids.map(|ids| ids.into_iter().collect());
    let mut remote_sources = store::load_remote_sources()?;

    let mut total = 0usize;
    let mut counters = SyncCounters {
        updated: 0,
        unchanged: 0,
        failed: 0,
    };
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
        sync_one_remote_source(&app, remote_source, &mut counters, &mut items).await;
    }

    if counters.updated > 0 {
        invalidate_index();
    }

    store::save_remote_sources(&remote_sources)?;

    Ok(RemoteSyncResult {
        total,
        updated: counters.updated,
        unchanged: counters.unchanged,
        failed: counters.failed,
        items,
    })
}
