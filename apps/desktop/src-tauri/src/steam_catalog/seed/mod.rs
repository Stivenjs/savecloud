pub mod api;
pub mod commands;
pub mod db;
pub mod streaming;
pub mod types;

use tauri::Emitter;

use crate::commands::sync::context::ApiContext;
use crate::sqlite::AppDb;
use types::*;

/// Límite de rondas por ejecución para prevenir bucles infinitos.
pub const STEAM_SEED_IMPORT_MAX_ROUNDS: u32 = 5000;

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
/// Los batches se descargan y procesan en paralelo según `concurrency`.
#[expect(
    clippy::too_many_arguments,
    reason = "Parámetros requeridos para sincronización incremental por lotes de catálogo"
)]
pub async fn import_cloud_seed_one_round(
    app: Option<&tauri::AppHandle>,
    db: &AppDb,
    ctx: &ApiContext,
    max_batches: u32,
    requested_strategy: &str,
    concurrency: usize,
    iteration: u32,
    total_batches_history: u32,
    total_rows_history: u32,
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
            },
        );
    }

    let to_process = match requested_strategy {
        "cursor" => {
            api::collect_cursor_keys(ctx, import_state.cursor_last_key.as_deref(), max_batches)
                .await?
        }
        "newest_first" => {
            api::collect_newest_first_keys(
                ctx,
                import_state.newest_watermark.as_deref(),
                max_batches,
            )
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
    let url_map = api::resolve_batch_download_urls(ctx, &to_process).await?;

    let total_to_process = to_process.len() as u32;

    use futures_util::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    let rows_updated = Arc::new(AtomicU32::new(0));

    // Candado compartido para serializar las escrituras a SQLite
    let db_write_lock = Arc::new(Mutex::new(()));

    stream::iter(
        to_process
            .iter()
            .enumerate()
            .map(|(i, k)| (i, k.clone()))
            .collect::<Vec<_>>(),
    )
    .map(|(idx, key)| {
        let url = url_map.get(&key).cloned();
        let db = db.clone();
        let app = app.cloned();
        let rows_updated = Arc::clone(&rows_updated);
        let write_lock = Arc::clone(&db_write_lock);

        async move {
            if let Some(url) = url {
                let progress_ctx = streaming::StreamProgressContext {
                    iteration,
                    total_batches_this_round: total_to_process,
                    global_total_batches: total_batches_history.saturating_add(idx as u32),
                    global_total_rows: total_rows_history
                        .saturating_add(rows_updated.load(Ordering::Relaxed)),
                };

                match streaming::stream_import_batch(
                    app.as_ref(),
                    Some(&progress_ctx),
                    &key,
                    &db,
                    &url,
                    None,
                    write_lock,
                )
                .await
                {
                    Ok(n) => {
                        rows_updated.fetch_add(n, Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("[steam-seed] Error en batch {}: {}", key, e);
                    }
                }
            }
        }
    })
    .buffer_unordered(concurrency)
    .collect::<()>()
    .await;

    let rows_updated = rows_updated.load(Ordering::Relaxed);

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
        ctx,
        max_batches,
        requested_strategy,
        concurrency,
        iteration,
        total_batches_history.saturating_add(to_process.len() as u32),
        total_rows_history.saturating_add(rows_updated),
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
    ctx: &ApiContext,
    max_batches: u32,
    requested_strategy: &str,
    concurrency: usize,
    iteration: u32,
    total_batches_history: u32,
    total_rows_history: u32,
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
            api::collect_cursor_review_keys(
                ctx,
                import_state.cursor_last_key.as_deref(),
                max_batches,
            )
            .await?
        }
        "newest_first" => {
            api::collect_newest_first_review_keys(
                ctx,
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

    let url_map = api::resolve_reviews_batch_download_urls(ctx, &to_process).await?;
    let total_to_process = to_process.len() as u32;

    use futures_util::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    let rows_updated = Arc::new(AtomicU32::new(0));
    let db_write_lock = Arc::new(Mutex::new(()));

    stream::iter(
        to_process
            .iter()
            .enumerate()
            .map(|(i, k)| (i, k.clone()))
            .collect::<Vec<_>>(),
    )
    .map(|(idx, key)| {
        let url = url_map.get(&key).cloned();
        let db = db.clone();
        let app = app.cloned();
        let rows_updated = Arc::clone(&rows_updated);
        let write_lock = Arc::clone(&db_write_lock);

        async move {
            if let Some(url) = url {
                let progress_ctx = streaming::StreamProgressContext {
                    iteration,
                    total_batches_this_round: total_to_process,
                    global_total_batches: total_batches_history.saturating_add(idx as u32),
                    global_total_rows: total_rows_history
                        .saturating_add(rows_updated.load(Ordering::Relaxed)),
                };

                match streaming::stream_import_reviews_batch(
                    app.as_ref(),
                    Some(&progress_ctx),
                    &key,
                    &db,
                    &url,
                    write_lock,
                )
                .await
                {
                    Ok(n) => {
                        rows_updated.fetch_add(n, Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("[steam-seed] Error en reviews batch {}: {}", key, e);
                    }
                }
            }
        }
    })
    .buffer_unordered(concurrency)
    .collect::<()>()
    .await;

    let rows_updated = rows_updated.load(Ordering::Relaxed);

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
