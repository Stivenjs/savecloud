pub mod api;
mod batching;
pub mod commands;
pub mod db;
mod pipeline;
mod request;
pub mod streaming;
pub mod types;

use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::sqlite::AppDb;
use crate::utils::transfer_metrics::TransferSpeedTracker;
use types::*;

/// Límite de rondas por ejecución para prevenir bucles infinitos.
pub const STEAM_SEED_IMPORT_MAX_ROUNDS: u32 = 5000;
const DETAILS_GROUP_ROWS: usize = 5_000;
const REVIEWS_GROUP_ROWS: usize = 2_000;
const ETA_BATCH_UNIT_BYTES: u64 = 1024 * 1024;
/// Concurrencia de descargas de detalles, limitada para no saturar el pool HTTP.
pub const DEFAULT_DETAILS_DOWNLOAD_CONCURRENCY: usize = 16;
/// Concurrencia de descargas de reseñas, independientes de las escrituras SQLite.
pub const DEFAULT_REVIEWS_DOWNLOAD_CONCURRENCY: usize = 24;

fn eta_progress_units(batches: u32) -> u64 {
    u64::from(batches).saturating_mul(ETA_BATCH_UNIT_BYTES)
}

fn invalidate_details_cache(app_ids: &[u32]) {
    crate::steam_cache::steam_api_cache().invalidate_many(app_ids);
}

fn emit_persist_progress(
    app: Option<&tauri::AppHandle>,
    iteration: u32,
    batches_this_round: u32,
    total_batches: u32,
    total_rows_updated: u32,
    rows_this_round: u32,
    status_text: &str,
    started_at: Instant,
    eta_seconds: Option<u64>,
) {
    let Some(app) = app else {
        return;
    };

    let _ = app.emit(
        "steam-seed-import-progress",
        SteamSeedImportProgressPayload {
            iteration,
            batches_this_round,
            rows_this_round,
            total_batches,
            total_rows_updated,
            status_text: Some(status_text.to_string()),
            current_batch: None,
            done: false,
            elapsed_seconds: started_at.elapsed().as_secs(),
            eta_seconds,
        },
    );
}

async fn checkpoint_import_before_failure(
    db: &AppDb,
    state: &mut SteamSeedImportState,
    strategy: &str,
    keys: &[String],
    failed_index: usize,
) -> Result<(), String> {
    if failed_index > 0 {
        let previous_key = keys[failed_index - 1].clone();
        match strategy {
            "cursor" => state.cursor_last_key = Some(previous_key),
            "newest_first" => state.newest_watermark = Some(previous_key),
            _ => return Err("estrategia de import no soportada".to_string()),
        }
    }
    state.strategy = strategy.to_string();

    let db_save = db.clone();
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        db_save.with_conn(|conn| {
            db::save_import_state(conn, &state)?;
            Ok(())
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: crate::sqlite::error::SqliteError| error.to_string())
}

async fn checkpoint_reviews_before_failure(
    db: &AppDb,
    state: &mut SteamSeedReviewsImportState,
    strategy: &str,
    keys: &[String],
    failed_index: usize,
) -> Result<(), String> {
    if failed_index > 0 {
        let previous_key = keys[failed_index - 1].clone();
        match strategy {
            "cursor" => state.cursor_last_key = Some(previous_key),
            "newest_first" => state.newest_watermark = Some(previous_key),
            _ => return Err("estrategia de import de reviews no soportada".to_string()),
        }
    }
    state.strategy = strategy.to_string();

    let db_save = db.clone();
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        db_save.with_conn(|conn| {
            db::save_reviews_import_state(conn, &state)?;
            Ok(())
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: crate::sqlite::error::SqliteError| error.to_string())
}

/// Devuelve la clave de batch local más avanzada conocida.
pub fn effective_local_max_imported(state: &SteamSeedImportState) -> Option<String> {
    state
        .max_imported_batch_key
        .clone()
        .or_else(|| state.cursor_last_key.clone())
}

/// Extrae el prefijo `steam-seed/{ownerId}` de una clave S3 completa.
pub fn steam_seed_scope_prefix(key: &str) -> Option<&str> {
    key.find("/batches/").map(|i| &key[..i])
}

/// Valida que local y nube pertenecen al mismo scope S3.
pub fn local_max_if_same_scope_as_cloud<'a>(
    cloud_last: Option<&'a str>,
    local_max: Option<&'a str>,
) -> Option<&'a str> {
    let cloud = cloud_last.filter(|s| !s.is_empty())?;
    let local = local_max?;
    match (
        steam_seed_scope_prefix(cloud),
        steam_seed_scope_prefix(local),
    ) {
        (Some(pc), Some(pl)) if pc == pl => Some(local),
        _ => None,
    }
}

/// Calcula el estado de frescura del seed.
pub fn compute_steam_seed_freshness_status(
    cloud_last: Option<&str>,
    local_max: Option<&str>,
) -> &'static str {
    let cloud = match cloud_last {
        None | Some("") => return "no_cloud_batches",
        Some(s) => s,
    };
    match local_max {
        None => "no_local_import",
        Some(l) if cloud > l => "stale",
        Some(_) => "up_to_date",
    }
}

/// Valida y normaliza el nombre de la estrategia de importación.
pub fn parse_import_strategy(s: Option<&str>) -> Result<String, String> {
    match s.map(str::trim).filter(|x| !x.is_empty()) {
        None => Ok("cursor".to_string()),
        Some(x) if x.eq_ignore_ascii_case("cursor") => Ok("cursor".to_string()),
        Some(x) if x.eq_ignore_ascii_case("newest_first") => Ok("newest_first".to_string()),
        Some(x) => Err(format!(
            "strategy inválida: {} (usa 'cursor' o 'newest_first')",
            x
        )),
    }
}

/// Ejecuta una única ronda de importación de batches del seed en la nube.
/// Las descargas de detalles y reseñas usan concurrencias independientes.
/// La persistencia permanece serializada por un único lock de escritura.
#[expect(
    clippy::too_many_arguments,
    reason = "Parámetros requeridos para sincronización incremental por lotes de catálogo"
)]
pub async fn import_cloud_seed_one_round(
    app: Option<&tauri::AppHandle>,
    db: &AppDb,
    max_batches: u32,
    requested_strategy: &str,
    details_concurrency: usize,
    reviews_concurrency: usize,
    iteration: u32,
    total_batches_history: u32,
    total_rows_history: u32,
    started_at: Instant,
) -> Result<SteamSeedResultDto, String> {
    let db_load = db.clone();
    let mut import_state =
        tokio::task::spawn_blocking(move || db_load.with_conn(db::load_or_init_import_state))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    if import_state.strategy != requested_strategy {
        import_state.cursor_last_key = None;
        import_state.newest_watermark = None;
        import_state.max_imported_batch_key = None;
    }

    if let Some(a) = app {
        let _ = a.emit(
            "steam-seed-import-progress",
            SteamSeedImportProgressPayload {
                iteration,
                batches_this_round: 0,
                rows_this_round: 0,
                total_batches: total_batches_history,
                total_rows_updated: total_rows_history,
                status_text: Some("Calculando lista de batches pendientes...".to_string()),
                current_batch: None,
                done: false,
                elapsed_seconds: started_at.elapsed().as_secs(),
                eta_seconds: None,
            },
        );
    }

    let to_process = match requested_strategy {
        "cursor" => {
            api::collect_cursor_keys(import_state.cursor_last_key.as_deref(), max_batches).await?
        }
        "newest_first" => {
            api::collect_newest_first_keys(import_state.newest_watermark.as_deref(), max_batches)
                .await?
        }
        _ => return Err("estrategia de import no soportada".to_string()),
    };

    if to_process.is_empty() {
        return Ok(SteamSeedImportResultDto {
            batches_processed: 0,
            rows_updated: 0,
        });
    }

    // Resolvemos las URLs en bloque para ahorrar latencia
    let url_map = api::resolve_batch_download_urls(&to_process).await?;

    let total_to_process = to_process.len() as u32;

    // Candado compartido para serializar las escrituras a SQLite
    let db_write_lock = Arc::new(Mutex::new(()));

    let url_map_for_download = url_map;
    let keys_for_download = to_process.clone();
    let (mut downloads, producer) =
        pipeline::start_download_pipeline(keys_for_download, details_concurrency, move |idx, key| {
            let url = url_map_for_download.get(&key).cloned();
            async move {
                pipeline::download_with_retries(idx, key, url, "batch", |key, url| {
                    async move {
                        streaming::download_seed_batch(&key, &url).await
                    }
                })
                .await
            }
        });

    let mut first_failure: Option<(usize, String)> = None;
    let mut rows_updated = 0u32;
    let mut completed_batches = 0u32;
    let mut speed_tracker = TransferSpeedTracker::new();
    let mut group = batching::BatchAccumulator::new(DETAILS_GROUP_ROWS, 20);
    while let Some((index, _key, result)) = downloads.recv().await {
        let updates = match result {
            Ok(updates) => updates,
            Err(error) => {
                if first_failure
                    .as_ref()
                    .is_none_or(|(first_index, _)| index < *first_index)
                {
                    first_failure = Some((index, error));
                }
                continue;
            }
        };

        completed_batches = completed_batches.saturating_add(1);
        group.push_batch(updates);
        if group.should_flush() {
            let updates = group.take();
            let app_ids: Vec<u32> = updates.iter().map(|(app_id, _)| *app_id).collect();
            rows_updated = rows_updated
                .saturating_add(streaming::persist_seed_group(db, updates, &db_write_lock).await?);
            invalidate_details_cache(&app_ids);
            let sample = speed_tracker.record(
                eta_progress_units(completed_batches),
                eta_progress_units(total_to_process),
                Instant::now(),
            );
            emit_persist_progress(
                app,
                iteration,
                total_to_process,
                total_batches_history.saturating_add(completed_batches),
                total_rows_history.saturating_add(rows_updated),
                rows_updated,
                "Guardando detalles del catálogo...",
                started_at,
                sample.eta_seconds,
            );
        }
    }

    if !group.is_empty() {
        let updates = group.take();
        let app_ids: Vec<u32> = updates.iter().map(|(app_id, _)| *app_id).collect();
        rows_updated = rows_updated
            .saturating_add(streaming::persist_seed_group(db, updates, &db_write_lock).await?);
        invalidate_details_cache(&app_ids);
        let sample = speed_tracker.record_final(
            eta_progress_units(completed_batches),
            eta_progress_units(total_to_process),
            Instant::now(),
        );
        emit_persist_progress(
            app,
            iteration,
            total_to_process,
            total_batches_history.saturating_add(completed_batches),
            total_rows_history.saturating_add(rows_updated),
            rows_updated,
            "Guardando detalles del catálogo...",
            started_at,
            sample.eta_seconds,
        );
    }

    producer
        .await
        .map_err(|error| format!("Worker de descargas falló: {error}"))?;

    if let Some((failed_index, error)) = first_failure {
        checkpoint_import_before_failure(
            db,
            &mut import_state,
            requested_strategy,
            &to_process,
            failed_index,
        )
        .await?;
        return Err(format!(
            "{error}. El progreso correcto quedó guardado; vuelve a intentar."
        ));
    }

    match requested_strategy {
        "cursor" => {
            import_state.cursor_last_key = to_process.iter().max().cloned();
        }
        "newest_first" => {
            import_state.newest_watermark = to_process.iter().min().cloned();
        }
        _ => {}
    }
    import_state.strategy = requested_strategy.to_string();

    let batch_max = to_process
        .iter()
        .max()
        .cloned()
        .expect("to_process no vacío");
    import_state.max_imported_batch_key = Some(match import_state.max_imported_batch_key.take() {
        None => batch_max,
        Some(prev) if batch_max > prev => batch_max,
        Some(prev) => prev,
    });

    let db_save = db.clone();
    tokio::task::spawn_blocking(move || {
        db_save.with_conn(|conn| {
            db::save_import_state(conn, &import_state)?;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    let reviews_result = import_cloud_seed_reviews_one_round(
        app,
        db,
        max_batches,
        requested_strategy,
        reviews_concurrency,
        iteration,
        total_batches_history.saturating_add(to_process.len() as u32),
        total_rows_history.saturating_add(rows_updated),
        started_at,
    )
    .await?;

    Ok(SteamSeedImportResultDto {
        batches_processed: (to_process.len() as u32)
            .saturating_add(reviews_result.batches_processed),
        rows_updated: rows_updated.saturating_add(reviews_result.rows_updated),
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "Parámetros requeridos para sincronización incremental de reseñas"
)]
async fn import_cloud_seed_reviews_one_round(
    app: Option<&tauri::AppHandle>,
    db: &AppDb,
    max_batches: u32,
    requested_strategy: &str,
    reviews_concurrency: usize,
    iteration: u32,
    total_batches_history: u32,
    total_rows_history: u32,
    started_at: Instant,
) -> Result<SteamSeedImportResultDto, String> {
    let db_load = db.clone();
    let mut import_state = tokio::task::spawn_blocking(move || {
        db_load.with_conn(db::load_or_init_reviews_import_state)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    if import_state.strategy != requested_strategy {
        import_state.cursor_last_key = None;
        import_state.newest_watermark = None;
        import_state.max_imported_batch_key = None;
    }

    let to_process = match requested_strategy {
        "cursor" => {
            api::collect_cursor_review_keys(import_state.cursor_last_key.as_deref(), max_batches)
                .await?
        }
        "newest_first" => {
            api::collect_newest_first_review_keys(
                import_state.newest_watermark.as_deref(),
                max_batches,
            )
            .await?
        }
        _ => return Err("estrategia de import de reviews no soportada".to_string()),
    };

    if to_process.is_empty() {
        return Ok(SteamSeedImportResultDto {
            batches_processed: 0,
            rows_updated: 0,
        });
    }

    let url_map = api::resolve_reviews_batch_download_urls(&to_process).await?;
    let total_to_process = to_process.len() as u32;

    use std::sync::Arc;
    use tokio::sync::Mutex;

    let db_write_lock = Arc::new(Mutex::new(()));

    let url_map_for_download = url_map;
    let keys_for_download = to_process.clone();
    let (mut downloads, producer) =
        pipeline::start_download_pipeline(keys_for_download, reviews_concurrency, move |idx, key| {
            let url = url_map_for_download.get(&key).cloned();
            async move {
                pipeline::download_with_retries(idx, key, url, "batch de reviews", |key, url| {
                    async move {
                        streaming::download_reviews_batch(&key, &url).await
                    }
                })
                .await
            }
        });

    let mut first_failure: Option<(usize, String)> = None;
    let mut rows_updated = 0u32;
    let mut completed_batches = 0u32;
    let mut speed_tracker = TransferSpeedTracker::new();
    let mut group = batching::BatchAccumulator::new(REVIEWS_GROUP_ROWS, 20);
    while let Some((index, _key, result)) = downloads.recv().await {
        let updates = match result {
            Ok(updates) => updates,
            Err(error) => {
                if first_failure
                    .as_ref()
                    .is_none_or(|(first_index, _)| index < *first_index)
                {
                    first_failure = Some((index, error));
                }
                continue;
            }
        };

        completed_batches = completed_batches.saturating_add(1);
        group.push_batch(updates);
        if group.should_flush() {
            rows_updated = rows_updated.saturating_add(
                streaming::persist_reviews_group(db, group.take(), &db_write_lock).await?,
            );
            emit_persist_progress(
                app,
                iteration,
                total_to_process,
                total_batches_history.saturating_add(completed_batches),
                total_rows_history.saturating_add(rows_updated),
                rows_updated,
                "Guardando reseñas del catálogo...",
                started_at,
                speed_tracker
                    .record(
                        eta_progress_units(completed_batches),
                        eta_progress_units(total_to_process),
                        Instant::now(),
                    )
                    .eta_seconds,
            );
        }
    }

    if !group.is_empty() {
        rows_updated = rows_updated.saturating_add(
            streaming::persist_reviews_group(db, group.take(), &db_write_lock).await?,
        );
        emit_persist_progress(
            app,
            iteration,
            total_to_process,
            total_batches_history.saturating_add(completed_batches),
            total_rows_history.saturating_add(rows_updated),
            rows_updated,
            "Guardando reseñas del catálogo...",
            started_at,
            speed_tracker
                .record_final(
                    eta_progress_units(completed_batches),
                    eta_progress_units(total_to_process),
                    Instant::now(),
                )
                .eta_seconds,
        );
    }

    producer
        .await
        .map_err(|error| format!("Worker de descargas de reviews falló: {error}"))?;

    if let Some((failed_index, error)) = first_failure {
        checkpoint_reviews_before_failure(
            db,
            &mut import_state,
            requested_strategy,
            &to_process,
            failed_index,
        )
        .await?;
        return Err(format!(
            "{error}. El progreso correcto quedó guardado; vuelve a intentar."
        ));
    }

    match requested_strategy {
        "cursor" => {
            import_state.cursor_last_key = to_process.iter().max().cloned();
        }
        "newest_first" => {
            import_state.newest_watermark = to_process.iter().min().cloned();
        }
        _ => {}
    }
    import_state.strategy = requested_strategy.to_string();

    let batch_max = to_process
        .iter()
        .max()
        .cloned()
        .expect("to_process de reviews no vacío");
    import_state.max_imported_batch_key = Some(match import_state.max_imported_batch_key.take() {
        None => batch_max,
        Some(prev) if batch_max > prev => batch_max,
        Some(prev) => prev,
    });

    let db_save = db.clone();
    tokio::task::spawn_blocking(move || {
        db_save.with_conn(|conn| {
            db::save_reviews_import_state(conn, &import_state)?;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    Ok(SteamSeedImportResultDto {
        batches_processed: to_process.len() as u32,
        rows_updated,
    })
}

// Alias para compatibilidad con el retorno de la ronda
pub type SteamSeedResultDto = SteamSeedImportResultDto;

#[cfg(test)]
mod tests {
    use super::{compute_steam_seed_freshness_status, local_max_if_same_scope_as_cloud};

    #[test]
    fn scope_mismatch_ignores_local_max() {
        let cloud = Some("steam-seed/hostOwner/batches/00000002.jsonl");
        let local_other = Some("steam-seed/selfUser/batches/00000099.jsonl");
        assert_eq!(local_max_if_same_scope_as_cloud(cloud, local_other), None);
        assert_eq!(
            compute_steam_seed_freshness_status(
                cloud,
                local_max_if_same_scope_as_cloud(cloud, local_other)
            ),
            "no_local_import"
        );
    }

    #[test]
    fn same_scope_compares_lex() {
        let cloud = "steam-seed/hostOwner/batches/00000002.jsonl";
        let local = "steam-seed/hostOwner/batches/00000001.jsonl";
        assert_eq!(
            local_max_if_same_scope_as_cloud(Some(cloud), Some(local)),
            Some(local)
        );
        assert_eq!(
            compute_steam_seed_freshness_status(
                Some(cloud),
                local_max_if_same_scope_as_cloud(Some(cloud), Some(local))
            ),
            "stale"
        );
    }

    #[test]
    fn lex_order_detects_stale() {
        let k_old = "steam-seed/u/batches/00000001.jsonl";
        let k_new = "steam-seed/u/batches/00000002.jsonl";
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_new), Some(k_old)),
            "stale"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_old), Some(k_new)),
            "up_to_date"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_old), Some(k_old)),
            "up_to_date"
        );
    }

    #[test]
    fn no_cloud_no_local_variants() {
        assert_eq!(
            compute_steam_seed_freshness_status(None, Some("x")),
            "no_cloud_batches"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some("steam-seed/u/batches/00000001.jsonl"), None),
            "no_local_import"
        );
    }
}
