//! Comandos de catálogo local: listado, importación y eliminación.

use super::fetch::{fetch_catalog_for_import, sync_metadata_from_fetch};
use super::match_index::invalidate_index;
use super::super::domain::{
    BatchImportItemResult, BatchImportResult, ImportMode, SourceCatalogSummary, SourceItemsPage,
};
use super::super::parser::parse_catalog;
use super::super::queue::now_iso;
use super::super::store;

/// Lista todas las fuentes de catálogos completas almacenadas localmente.
#[tauri::command]
pub async fn list_sources() -> Result<Vec<super::super::domain::SourceCatalog>, String> {
    store::load_sources()
}

/// Resumen de catálogos instalados con conteo de descargas.
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

/// Página de items de un catálogo.
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

/// Elimina un catálogo por ID.
#[tauri::command]
pub async fn remove_source(source_id: String) -> Result<(), String> {
    let result = store::remove_catalog(&source_id);
    invalidate_index();
    result
}

/// Importa una fuente desde un archivo JSON local.
#[tauri::command]
pub async fn import_source_from_file(
    path: String,
    mode: ImportMode,
) -> Result<super::super::domain::SourceCatalog, String> {
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("No se pudo leer JSON: {e}"))?;
    let catalog = parse_catalog(&raw, Some(format!("file://{path}")))?;
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    Ok(result)
}

/// Importa varios archivos JSON en paralelo.
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

/// Importa una fuente descargándola por URL.
#[tauri::command]
pub async fn import_source_from_url(
    app: tauri::AppHandle,
    url: String,
    mode: ImportMode,
) -> Result<super::super::domain::SourceCatalog, String> {
    let fetched = fetch_catalog_for_import(&app, &url).await?;
    let checked_at = now_iso();
    let mut catalog = parse_catalog(&fetched.raw, Some(url))?;
    catalog.sync = Some(sync_metadata_from_fetch(
        &fetched.headers,
        &fetched.raw,
        checked_at,
    ));
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    Ok(result)
}
