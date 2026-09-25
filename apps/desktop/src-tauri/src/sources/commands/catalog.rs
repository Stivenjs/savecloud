//! Comandos de catálogo local: listado, importación y eliminación.

use super::fetch::{fetch_catalog_for_import, sync_metadata_from_fetch};
use super::match_index::invalidate_index;
use super::super::domain::{
    BatchImportItemResult, BatchImportResult, ImportMode, SourceCatalogSummary, SourceItemsPage,
};
use super::super::events::emit_catalog_updated;
use super::super::parser::parse_catalog_from_reader;
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
    store::load_sources_summary()
}

/// Página de items de un catálogo.
#[tauri::command]
pub async fn list_source_items_page(
    source_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<SourceItemsPage, String> {
    let safe_offset = offset.unwrap_or(0);
    let safe_limit = limit.unwrap_or(50).clamp(1, 200);
    store::load_source_items_page(&source_id, safe_offset, safe_limit)
}

/// Elimina un catálogo por ID.
#[tauri::command]
pub async fn remove_source(app: tauri::AppHandle, source_id: String) -> Result<(), String> {
    let result = store::remove_catalog(&source_id);
    invalidate_index();
    emit_catalog_updated(&app);
    result
}

/// Importa una fuente desde un archivo JSON local con streaming directo.
#[tauri::command]
pub async fn import_source_from_file(
    app: tauri::AppHandle,
    path: String,
    mode: ImportMode,
) -> Result<super::super::domain::SourceCatalog, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("No se pudo abrir archivo: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let catalog = parse_catalog_from_reader(reader, Some(format!("file://{path}")))?;
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    emit_catalog_updated(&app);
    Ok(result)
}

/// Importa varios archivos JSON en paralelo con streaming.
#[tauri::command]
pub async fn import_sources_from_files_batch(
    app: tauri::AppHandle,
    paths: Vec<String>,
    mode: ImportMode,
) -> Result<BatchImportResult, String> {
    let total = paths.len();

    let mut parse_tasks = Vec::with_capacity(total);
    for path in paths {
        let task = tokio::task::spawn_blocking(move || {
            let file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(e) => return Err((path, format!("No se pudo abrir archivo: {e}"))),
            };
            let reader = std::io::BufReader::new(file);
            match parse_catalog_from_reader(reader, Some(format!("file://{path}"))) {
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
            Err(join_err) => {
                failed += 1;
                items.push(BatchImportItemResult {
                    path: "desconocido".to_string(),
                    success: false,
                    catalog_id: None,
                    catalog_name: None,
                    error: Some(format!("Tarea abortada: {join_err}")),
                    was_updated: false,
                });
            }
        }
    }

    let mut imported = 0usize;
    for (path, catalog) in parsed {
        let catalog_id = catalog.id.clone();
        let catalog_name = catalog.name.clone();
        match store::upsert_catalog(catalog, mode.clone()) {
            Ok(_) => {
                imported += 1;
                items.push(BatchImportItemResult {
                    path,
                    success: true,
                    catalog_id: Some(catalog_id),
                    catalog_name: Some(catalog_name),
                    error: None,
                    was_updated: false,
                });
            }
            Err(error) => {
                failed += 1;
                items.push(BatchImportItemResult {
                    path,
                    success: false,
                    catalog_id: Some(catalog_id),
                    catalog_name: Some(catalog_name),
                    error: Some(error),
                    was_updated: false,
                });
            }
        }
    }

    invalidate_index();
    emit_catalog_updated(&app);

    Ok(BatchImportResult {
        total,
        succeeded: imported,
        failed,
        items,
    })
}

/// Importa o actualiza una fuente desde una URL remota.
#[tauri::command]
pub async fn import_source_from_url(
    app: tauri::AppHandle,
    url: String,
    mode: ImportMode,
) -> Result<super::super::domain::SourceCatalog, String> {
    let fetched = fetch_catalog_for_import(&app, &url).await?;
    let checked_at = now_iso();
    let mut catalog = parse_catalog_from_reader(fetched.raw.as_bytes(), Some(url))?;
    catalog.sync = Some(sync_metadata_from_fetch(
        &fetched.headers,
        &fetched.raw,
        checked_at,
    ));
    let result = store::upsert_catalog(catalog, mode)?;
    invalidate_index();
    emit_catalog_updated(&app);
    Ok(result)
}

/// Exporta todas las fuentes almacenadas en SQLite a un archivo JSON.
///
/// Si no se especifica `destination_path`, se genera un archivo en el directorio de caché
/// con nombre `sources_export_<timestamp>.json` y se devuelve su ruta absoluta.
#[tauri::command]
pub async fn export_sources_to_json(destination_path: Option<String>) -> Result<String, String> {
    let path = store::export_sources_to_file(destination_path.as_deref())?;
    Ok(path.to_string_lossy().to_string())
}

/// Exporta una fuente específica por `source_id` a un archivo JSON.
///
/// Si no se especifica `destination_path`, se genera un archivo en el directorio de caché
/// con nombre `source_<id>_<timestamp>.json` y se devuelve su ruta absoluta.
#[tauri::command]
pub async fn export_source_to_json(
    source_id: String,
    destination_path: Option<String>,
) -> Result<String, String> {
    let path = store::export_source_to_file(&source_id, destination_path.as_deref())?;
    Ok(path.to_string_lossy().to_string())
}


