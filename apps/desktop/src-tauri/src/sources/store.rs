//! Persistencia local del módulo de fuentes respaldada por SQLite con fallback/exportación JSON.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;

use crate::config::paths;
use crate::sqlite::AppDb;

use super::domain::{
    ImportMode, RemoteSourceConfig, SourceCatalog, SourceCatalogSummary, SourceDownloadJob,
    SourceItem, SourceItemsPage, SourceSyncMetadata, SourceUri,
};

fn get_db() -> Result<AppDb, String> {
    AppDb::open().map_err(|e| format!("Error al abrir base de datos SQLite: {e}"))
}

fn sources_path() -> Result<PathBuf, String> {
    let Some(path) =
        crate::config::profile_storage::scoped_or_legacy_path(paths::SOURCES_FILE_NAME)
    else {
        return Err("No se pudo resolver sources_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn jobs_path() -> Result<PathBuf, String> {
    let Some(path) =
        crate::config::profile_storage::scoped_or_legacy_path(paths::ACTIVE_JOBS_FILE_NAME)
    else {
        return Err("No se pudo resolver active_jobs_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn remote_sources_path() -> Result<PathBuf, String> {
    let Some(path) =
        crate::config::profile_storage::scoped_or_legacy_path(paths::REMOTE_SOURCES_FILE_NAME)
    else {
        return Err("No se pudo resolver remote_sources_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Auto-migra `sources.json` existente a SQLite si la tabla `sources` está vacía.
fn auto_migrate_legacy_json_if_needed(conn: &rusqlite::Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
        .unwrap_or(0);

    if count > 0 {
        return Ok(());
    }

    let candidates = [sources_path().ok(), paths::legacy_sources_path()];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            log::info!("[SourcesStore] Detectado sources.json heredado en {:?}. Iniciando migración a SQLite...", candidate);
            if let Ok(sources) = read_sources_file(&candidate) {
                if !sources.is_empty() {
                    save_sources_to_conn(conn, &sources)?;
                    log::info!(
                        "[SourcesStore] Migración completada exitosamente: {} fuentes importadas en SQLite",
                        sources.len()
                    );
                }
                let backup = candidate.with_extension("json.migrated");
                let _ = std::fs::rename(&candidate, &backup);
                break;
            }
        }
    }

    Ok(())
}

fn save_sources_to_conn(
    conn: &rusqlite::Connection,
    sources: &[SourceCatalog],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for catalog in sources {
        insert_catalog_in_tx(&tx, catalog)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_catalog_in_tx(
    tx: &rusqlite::Transaction<'_>,
    catalog: &SourceCatalog,
) -> Result<(), String> {
    let (etag, last_mod, content_hash, last_checked, last_synced, sync_err) = match &catalog.sync {
        Some(s) => (
            s.etag.as_deref(),
            s.last_modified.as_deref(),
            s.content_hash.as_deref(),
            s.last_checked_at.as_deref(),
            s.last_synced_at.as_deref(),
            s.sync_error.as_deref(),
        ),
        None => (None, None, None, None, None, None),
    };

    tx.execute(
        "INSERT OR REPLACE INTO sources (
            id, name, source_url, imported_at,
            etag, last_modified, content_hash, last_checked_at, last_synced_at, sync_error
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            &catalog.id,
            &catalog.name,
            &catalog.source_url,
            &catalog.imported_at,
            etag,
            last_mod,
            content_hash,
            last_checked,
            last_synced,
            sync_err
        ],
    )
    .map_err(|e| e.to_string())?;


    let mut existing_stmt = tx
        .prepare_cached(
            "SELECT item_id, title, uris_json, upload_date, file_size FROM source_items WHERE source_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut existing_map: HashMap<String, (String, String, Option<String>, Option<String>)> =
        HashMap::new();

    let rows = existing_stmt
        .query_map(rusqlite::params![&catalog.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (id, title, uris, upload_date, file_size) = row.map_err(|e| e.to_string())?;
        existing_map.insert(id, (title, uris, upload_date, file_size));
    }

    let mut new_item_ids = HashSet::with_capacity(catalog.downloads.len());
    let mut inserted_count = 0usize;
    let mut updated_count = 0usize;

    {
        let mut upsert_stmt = tx
            .prepare_cached(
                "INSERT OR REPLACE INTO source_items (
                    source_id, item_id, title, normalized_title, upload_date, file_size, uris_json, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|e| e.to_string())?;

        for item in &catalog.downloads {
            new_item_ids.insert(item.id.as_str());

            let uris_json = serde_json::to_string(&item.uris).unwrap_or_else(|_| "[]".to_string());

            if let Some((old_title, old_uris, old_upload, old_size)) = existing_map.get(&item.id) {
                if old_title == &item.title
                    && old_uris == &uris_json
                    && old_upload == &item.upload_date
                    && old_size == &item.file_size
                {
                    continue;
                }
                updated_count += 1;
            } else {
                inserted_count += 1;
            }

            let normalized = crate::sources::matcher::normalize_title(&item.title);
            let meta_json =
                serde_json::to_string(&item.metadata).unwrap_or_else(|_| "{}".to_string());

            upsert_stmt
                .execute(rusqlite::params![
                    &catalog.id,
                    &item.id,
                    &item.title,
                    &normalized,
                    &item.upload_date,
                    &item.file_size,
                    &uris_json,
                    &meta_json,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    let mut deleted_count = 0usize;
    {
        let mut delete_stmt = tx
            .prepare_cached("DELETE FROM source_items WHERE source_id = ?1 AND item_id = ?2")
            .map_err(|e| e.to_string())?;

        for existing_id in existing_map.keys() {
            if !new_item_ids.contains(existing_id.as_str()) {
                delete_stmt
                    .execute(rusqlite::params![&catalog.id, existing_id])
                    .map_err(|e| e.to_string())?;
                deleted_count += 1;
            }
        }
    }

    let unchanged_count = catalog.downloads.len().saturating_sub(inserted_count + updated_count);
    log::info!(
        "[sources] Delta sync para '{}': {} nuevos, {} modificados, {} eliminados, {} sin cambios (total: {})",
        catalog.name,
        inserted_count,
        updated_count,
        deleted_count,
        unchanged_count,
        catalog.downloads.len()
    );

    Ok(())
}

/// Indica si ya existe un catálogo persistido para la URL remota indicada.
#[allow(dead_code)]
pub fn catalog_exists_for_url(url: &str) -> Result<bool, String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        auto_migrate_legacy_json_if_needed(conn).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sources WHERE source_url = ?1)",
            rusqlite::params![url],
            |row| row.get(0),
        )
    })
    .map_err(|e| e.to_string())
}

/// Carga catálogo completo de fuentes persistido en SQLite.
pub fn load_sources() -> Result<Vec<SourceCatalog>, String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        auto_migrate_legacy_json_if_needed(conn).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        let mut stmt = conn.prepare(
            "SELECT id, name, source_url, imported_at, etag, last_modified, content_hash, last_checked_at, last_synced_at, sync_error
             FROM sources
             ORDER BY imported_at DESC",
        )?;

        let source_rows = stmt.query_map([], |row| {
            let etag: Option<String> = row.get(4)?;
            let last_modified: Option<String> = row.get(5)?;
            let content_hash: Option<String> = row.get(6)?;
            let last_checked_at: Option<String> = row.get(7)?;
            let last_synced_at: Option<String> = row.get(8)?;
            let sync_error: Option<String> = row.get(9)?;

            let sync = if etag.is_some()
                || last_modified.is_some()
                || content_hash.is_some()
                || last_checked_at.is_some()
                || last_synced_at.is_some()
                || sync_error.is_some()
            {
                Some(SourceSyncMetadata {
                    etag,
                    last_modified,
                    content_hash,
                    last_checked_at,
                    last_synced_at,
                    sync_error,
                })
            } else {
                None
            };

            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                sync,
            ))
        })?;

        let mut sources = Vec::new();
        for s_res in source_rows {
            let (id, name, source_url, imported_at, sync) = s_res?;
            sources.push(SourceCatalog {
                id,
                name,
                source_url,
                imported_at,
                downloads: Vec::new(),
                sync,
            });
        }

        let mut item_stmt = conn.prepare(
            "SELECT item_id, title, uris_json, upload_date, file_size, metadata_json
             FROM source_items
             WHERE source_id = ?1
             ORDER BY rowid ASC",
        )?;

        for source in &mut sources {
            let item_rows = item_stmt.query_map(rusqlite::params![&source.id], |row| {
                let uris_json: String = row.get(2)?;
                let metadata_json: String = row.get(5)?;
                let uris: Vec<SourceUri> = serde_json::from_str(&uris_json).unwrap_or_default();
                let metadata: std::collections::HashMap<String, serde_json::Value> =
                    serde_json::from_str(&metadata_json).unwrap_or_default();

                Ok(SourceItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    uris,
                    upload_date: row.get(3)?,
                    file_size: row.get(4)?,
                    metadata,
                })
            })?;

            for item in item_rows {
                source.downloads.push(item?);
            }
        }

        Ok(sources)
    })
    .map_err(|e| e.to_string())
}

/// Carga el resumen liviano de las fuentes registradas directamente desde SQLite sin deserializar items.
pub fn load_sources_summary() -> Result<Vec<SourceCatalogSummary>, String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        auto_migrate_legacy_json_if_needed(conn).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.source_url, s.imported_at, COUNT(i.item_id) as downloads_count
             FROM sources s
             LEFT JOIN source_items i ON s.id = i.source_id
             GROUP BY s.id
             ORDER BY s.imported_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let count: i64 = row.get(4)?;
            Ok(SourceCatalogSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                source_url: row.get(2)?,
                imported_at: row.get(3)?,
                downloads_count: count.max(0) as usize,
            })
        })?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .map_err(|e| e.to_string())
}

/// Carga una página específica de items de un catálogo de forma paginada en SQL.
pub fn load_source_items_page(
    source_id: &str,
    offset: usize,
    limit: usize,
) -> Result<SourceItemsPage, String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        auto_migrate_legacy_json_if_needed(conn).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sources WHERE id = ?1)",
            rusqlite::params![source_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_items WHERE source_id = ?1",
            rusqlite::params![source_id],
            |row| row.get(0),
        )?;

        let mut stmt = conn.prepare(
            "SELECT item_id, title, uris_json, upload_date, file_size, metadata_json
             FROM source_items
             WHERE source_id = ?1
             ORDER BY rowid ASC
             LIMIT ?2 OFFSET ?3",
        )?;

        let rows = stmt.query_map(
            rusqlite::params![source_id, limit as i64, offset as i64],
            |row| {
                let item_id: String = row.get(0)?;
                let title: String = row.get(1)?;
                let uris_json: String = row.get(2)?;
                let upload_date: Option<String> = row.get(3)?;
                let file_size: Option<String> = row.get(4)?;
                let metadata_json: String = row.get(5)?;

                let uris: Vec<SourceUri> = serde_json::from_str(&uris_json).unwrap_or_default();
                let metadata: std::collections::HashMap<String, serde_json::Value> =
                    serde_json::from_str(&metadata_json).unwrap_or_default();

                Ok(SourceItem {
                    id: item_id,
                    title,
                    uris,
                    upload_date,
                    file_size,
                    metadata,
                })
            },
        )?;

        let mut items = Vec::with_capacity(limit);
        for r in rows {
            items.push(r?);
        }

        Ok(SourceItemsPage {
            source_id: source_id.to_string(),
            total: total.max(0) as usize,
            offset,
            limit,
            items,
        })
    })
    .map_err(|e| format!("No se pudo cargar la página de fuentes: {e}"))
}

/// Guarda catálogo de fuentes completo en SQLite (compatibilidad).
#[allow(dead_code)]
pub fn save_sources(sources: &[SourceCatalog]) -> Result<(), String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        save_sources_to_conn(conn, sources).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })
    })
    .map_err(|e| e.to_string())
}

fn read_sources_file(path: &Path) -> Result<Vec<SourceCatalog>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("No se pudo parsear sources.json: {e}"))
}

/// Carga la configuración de fuentes remotas registradas.
pub fn load_remote_sources() -> Result<Vec<RemoteSourceConfig>, String> {
    let path = resolve_read_path(
        paths::remote_sources_path(),
        paths::legacy_remote_sources_path(),
    )?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("No se pudo parsear remote_sources.json: {e}"))
}

/// Guarda la configuración de fuentes remotas.
pub fn save_remote_sources(sources: &[RemoteSourceConfig]) -> Result<(), String> {
    let path = remote_sources_path()?;
    let payload = serde_json::to_vec_pretty(sources).map_err(|e| e.to_string())?;
    write_bytes_if_changed(&path, &payload)
}

/// Inserta o actualiza una fuente remota por `id`.
pub fn upsert_remote_source(config: RemoteSourceConfig) -> Result<RemoteSourceConfig, String> {
    let mut remote_sources = load_remote_sources()?;
    if let Some(existing) = remote_sources.iter_mut().find(|s| s.id == config.id) {
        *existing = config.clone();
    } else {
        remote_sources.push(config.clone());
    }
    save_remote_sources(&remote_sources)?;
    Ok(config)
}

/// Elimina una fuente remota por `id`.
pub fn remove_remote_source(source_id: &str) -> Result<(), String> {
    let mut remote_sources = load_remote_sources()?;
    remote_sources.retain(|s| s.id != source_id);
    save_remote_sources(&remote_sources)
}

/// Aplica merge/replace/update sobre fuentes existentes en SQLite.
pub fn upsert_catalog(
    mut catalog: SourceCatalog,
    mode: ImportMode,
) -> Result<SourceCatalog, String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        auto_migrate_legacy_json_if_needed(conn).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        let tx = conn.unchecked_transaction()?;

        match mode {
            ImportMode::Replace => {
                tx.execute("DELETE FROM source_items", [])?;
                tx.execute("DELETE FROM sources", [])?;
            }
            ImportMode::Merge => {}
            ImportMode::UpdateOrCreate => {
                let existing_id: Option<String> = tx
                    .query_row(
                        "SELECT id FROM sources WHERE name = ?1 LIMIT 1",
                        rusqlite::params![&catalog.name],
                        |row| row.get(0),
                    )
                    .optional()?;

                if let Some(old_id) = existing_id {
                    catalog.id = old_id;
                }
            }
        }

        insert_catalog_in_tx(&tx, &catalog).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e,
            )))
        })?;

        tx.commit()?;
        Ok(catalog)
    })
    .map_err(|e| e.to_string())
}

/// Elimina un catálogo por ID en SQLite.
pub fn remove_catalog(source_id: &str) -> Result<(), String> {
    let db = get_db()?;
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM source_items WHERE source_id = ?1",
            rusqlite::params![source_id],
        )?;
        tx.execute(
            "DELETE FROM sources WHERE id = ?1",
            rusqlite::params![source_id],
        )?;
        tx.commit()?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

/// Carga jobs activos/históricos.
pub fn load_jobs() -> Result<Vec<SourceDownloadJob>, String> {
    let path = resolve_read_path(paths::active_jobs_path(), paths::legacy_active_jobs_path())?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("No se pudo parsear active_jobs.json: {e}"))
}

/// Guarda jobs.
pub fn save_jobs(jobs: &[SourceDownloadJob]) -> Result<(), String> {
    let path = jobs_path()?;
    let payload = serde_json::to_vec_pretty(jobs).map_err(|e| e.to_string())?;
    write_bytes_if_changed(&path, &payload)
}

/// Exporta todas las fuentes de SQLite a un String JSON con formato legible.
pub fn export_all_sources_json() -> Result<String, String> {
    let sources = load_sources()?;
    serde_json::to_string_pretty(&sources)
        .map_err(|e| format!("Error al serializar fuentes a JSON: {e}"))
}

/// Exporta un catálogo específico de SQLite a un String JSON con formato legible.
pub fn export_source_json(source_id: &str) -> Result<String, String> {
    let sources = load_sources()?;
    let source = sources
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;
    serde_json::to_string_pretty(&source)
        .map_err(|e| format!("Error al serializar fuente a JSON: {e}"))
}

/// Exporta todas las fuentes a un archivo en disco. Si no se indica ruta, usa una ruta en cache.
pub fn export_sources_to_file(target_path: Option<&str>) -> Result<PathBuf, String> {
    let path = match target_path {
        Some(p) => PathBuf::from(p),
        None => {
            let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
            let default_dir = paths::cache_dir().unwrap_or_else(|| PathBuf::from("."));
            default_dir.join(format!("sources_export_{timestamp}.json"))
        }
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let payload = export_all_sources_json()?;
    std::fs::write(&path, payload)
        .map_err(|e| format!("No se pudo escribir archivo de exportación: {e}"))?;
    Ok(path)
}

/// Exporta un catálogo específico a un archivo en disco.
pub fn export_source_to_file(
    source_id: &str,
    target_path: Option<&str>,
) -> Result<PathBuf, String> {
    let path = match target_path {
        Some(p) => PathBuf::from(p),
        None => {
            let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
            let default_dir = paths::cache_dir().unwrap_or_else(|| PathBuf::from("."));
            let safe_name =
                source_id.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
            default_dir.join(format!("source_{safe_name}_{timestamp}.json"))
        }
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let payload = export_source_json(source_id)?;
    std::fs::write(&path, payload)
        .map_err(|e| format!("No se pudo escribir archivo de exportación: {e}"))?;
    Ok(path)
}

fn resolve_read_path(primary: Option<PathBuf>, legacy: Option<PathBuf>) -> Result<PathBuf, String> {
    let Some(primary) = primary else {
        return Err("No se pudo resolver ruta principal".to_string());
    };
    if primary.exists() {
        return Ok(primary);
    }
    if let Some(legacy) = legacy {
        if legacy.exists() {
            return Ok(legacy);
        }
    }
    Ok(primary)
}

fn write_bytes_if_changed(path: &Path, payload: &[u8]) -> Result<(), String> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == payload {
            return Ok(());
        }
    }
    write_bytes_atomic(path, payload)
}

fn write_bytes_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let temp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file.json")
    ));
    std::fs::write(&temp, payload).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::domain::{DownloadProtocol, SourceItem, SourceUri};
    use rusqlite::Connection;
    use std::collections::HashMap;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in memory sqlite");
        conn.execute_batch(include_str!("../sqlite/sql/022_sources_schema.sql"))
            .expect("migration 022");
        conn
    }

    #[test]
    fn test_save_and_query_sources() {
        let conn = setup_test_db();
        let catalog = SourceCatalog {
            id: "src-1".to_string(),
            name: "Test Repack".to_string(),
            source_url: Some("https://example.com/source.json".to_string()),
            imported_at: "2026-08-30T12:00:00Z".to_string(),
            downloads: vec![
                SourceItem {
                    id: "item-1".to_string(),
                    title: "Grand Adventure II".to_string(),
                    uris: vec![SourceUri {
                        uri: "magnet:?xt=urn:btih:abcdef".to_string(),
                        protocol: DownloadProtocol::TorrentMagnet,
                        priority: 0,
                    }],
                    upload_date: Some("2026-08-01".to_string()),
                    file_size: Some("12.5 GB".to_string()),
                    metadata: HashMap::new(),
                },
                SourceItem {
                    id: "item-2".to_string(),
                    title: "Space Combat".to_string(),
                    uris: vec![SourceUri {
                        uri: "https://example.com/game.zip".to_string(),
                        protocol: DownloadProtocol::Http,
                        priority: 1,
                    }],
                    upload_date: Some("2026-08-02".to_string()),
                    file_size: Some("2.1 GB".to_string()),
                    metadata: HashMap::new(),
                },
            ],
            sync: None,
        };

        save_sources_to_conn(&conn, &[catalog]).expect("save sources");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))
            .expect("count sources");
        assert_eq!(count, 1);

        let items_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM source_items", [], |r| r.get(0))
            .expect("count items");
        assert_eq!(items_count, 2);

        let norm_title: String = conn
            .query_row(
                "SELECT normalized_title FROM source_items WHERE item_id = 'item-1'",
                [],
                |r| r.get(0),
            )
            .expect("norm title");
        assert_eq!(norm_title, "grand adventure 2");
    }

    #[test]
    fn test_delete_and_cascade() {
        let conn = setup_test_db();
        let catalog = SourceCatalog {
            id: "src-del".to_string(),
            name: "Delete Me".to_string(),
            source_url: None,
            imported_at: "2026-08-30T12:00:00Z".to_string(),
            downloads: vec![SourceItem {
                id: "item-del-1".to_string(),
                title: "Game To Delete".to_string(),
                uris: vec![],
                upload_date: None,
                file_size: None,
                metadata: HashMap::new(),
            }],
            sync: None,
        };

        save_sources_to_conn(&conn, &[catalog]).expect("save");

        conn.execute("DELETE FROM source_items WHERE source_id = 'src-del'", [])
            .expect("delete items");
        conn.execute("DELETE FROM sources WHERE id = 'src-del'", [])
            .expect("delete source");

        let src_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sources WHERE id = 'src-del'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        let item_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM source_items WHERE source_id = 'src-del'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(src_count, 0);
        assert_eq!(item_count, 0);
    }
}
