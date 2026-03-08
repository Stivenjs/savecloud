//! Descarga de guardados desde la nube.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Utc};
use futures_util::stream::{self, StreamExt};

use super::api;
use super::backup;
use super::models::{
    DownloadConflictDto, DownloadConflictsResultDto, GameConflictsResultDto, GameSyncResultDto,
    RemoteSaveInfoDto, SyncProgressPayload, SyncResultDto, UnsyncedGameDto,
};
use super::path_utils;
use crate::tray_state::TrayState;
use tauri::{AppHandle, Emitter, State};

/// Calcula los conflictos de descarga para un juego dado su ruta base y la lista de saves remotos.
fn check_conflicts_for_game(
    _game_id: &str,
    dest_base: &std::path::Path,
    saves: &[RemoteSaveInfoDto],
) -> Vec<DownloadConflictDto> {
    let mut conflicts = Vec::new();
    for save in saves {
        let dest_path = dest_base.join(&save.filename);
        let Ok(meta) = fs::metadata(&dest_path) else {
            continue;
        };
        let Ok(local_mtime) = meta.modified() else {
            continue;
        };
        let cloud_dt: DateTime<Utc> = match DateTime::parse_from_rfc3339(&save.last_modified)
            .or_else(|_| DateTime::parse_from_rfc2822(&save.last_modified))
        {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };
        let Ok(duration) = local_mtime.duration_since(UNIX_EPOCH) else {
            continue;
        };
        let Some(local_dt) =
            DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
        else {
            continue;
        };
        if local_dt > cloud_dt {
            conflicts.push(DownloadConflictDto {
                filename: save.filename.clone(),
                local_modified: local_dt.to_rfc3339(),
                cloud_modified: save.last_modified.clone(),
            });
        }
    }
    conflicts
}

#[tauri::command]
pub async fn sync_check_download_conflicts(
    game_id: String,
) -> Result<DownloadConflictsResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta de destino".into()),
    };

    let all = api::sync_list_remote_saves().await?;
    let saves: Vec<RemoteSaveInfoDto> = all
        .into_iter()
        .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
        .collect();

    let conflicts = check_conflicts_for_game(&game_id, &dest_base, &saves);
    Ok(DownloadConflictsResultDto { conflicts })
}

/// Comprueba conflictos de descarga para varios juegos en una sola llamada (una sola lista remota).
#[tauri::command]
pub async fn sync_check_download_conflicts_batch(
    game_ids: Vec<String>,
) -> Result<Vec<GameConflictsResultDto>, String> {
    if game_ids.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = crate::config::load_config();
    let all = api::sync_list_remote_saves().await?;
    let mut results = Vec::with_capacity(game_ids.len());
    for game_id in game_ids {
        let game = match cfg
            .games
            .iter()
            .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        {
            Some(g) => g,
            None => {
                results.push(GameConflictsResultDto {
                    game_id: game_id.clone(),
                    conflicts: Vec::new(),
                });
                continue;
            }
        };
        let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
            Some(p) => PathBuf::from(p),
            None => {
                results.push(GameConflictsResultDto {
                    game_id: game_id.clone(),
                    conflicts: Vec::new(),
                });
                continue;
            }
        };
        let saves: Vec<RemoteSaveInfoDto> = all
            .iter()
            .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
            .cloned()
            .collect();
        let conflicts = check_conflicts_for_game(&game_id, &dest_base, &saves);
        results.push(GameConflictsResultDto {
            game_id: game_id.clone(),
            conflicts,
        });
    }
    Ok(results)
}

#[tauri::command]
pub async fn sync_check_unsynced_games() -> Result<Vec<UnsyncedGameDto>, String> {
    let cfg = crate::config::load_config();
    let _ = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let _ = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;

    let remote = api::sync_list_remote_saves().await?;
    let remote_map: std::collections::HashMap<(String, String), DateTime<Utc>> = remote
        .into_iter()
        .filter_map(|s| {
            let dt = DateTime::parse_from_rfc3339(&s.last_modified)
                .or_else(|_| DateTime::parse_from_rfc2822(&s.last_modified))
                .ok()?;
            Some((
                (s.game_id.to_lowercase(), s.filename),
                dt.with_timezone(&Utc),
            ))
        })
        .collect();

    let mut unsynced = Vec::new();

    for game in &cfg.games {
        let local_files = path_utils::list_all_files_with_mtime(&game.paths);
        let mut has_unsynced = false;

        for (_abs, rel, mtime, _size) in local_files {
            let Ok(duration) = mtime.duration_since(UNIX_EPOCH) else {
                continue;
            };
            let Some(local_dt) =
                DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
            else {
                continue;
            };
            let local_dt = local_dt.with_timezone(&Utc);

            let key = (game.id.to_lowercase(), rel.clone());
            match remote_map.get(&key) {
                None => has_unsynced = true,
                Some(&cloud_dt) if local_dt > cloud_dt => has_unsynced = true,
                _ => {}
            }
        }

        if has_unsynced {
            unsynced.push(UnsyncedGameDto {
                game_id: game.id.clone(),
            });
        }
    }

    Ok(unsynced)
}

const DOWNLOAD_PROGRESS_EMIT_BYTES: u64 = 256 * 1024;
/// Archivos descargados en paralelo por juego.
/// 8–16 suele ser óptimo; más puede saturar la conexión o el disco y empeorar.
const DOWNLOAD_FILE_CONCURRENCY: usize = 16;

/// Descarga un solo archivo (para ejecutar en paralelo con otros).
async fn download_one_file(
    client: &reqwest::Client,
    dest_base: &std::path::Path,
    backup_dir: Option<&std::path::Path>,
    save: &RemoteSaveInfoDto,
    download_url: &str,
    game_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let dest_path = dest_base.join(&save.filename);
    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if dest_path.exists() {
        if let Some(backup_base) = backup_dir {
            if let Ok(rel) = dest_path.strip_prefix(dest_base) {
                let backup_path = backup_base.join(rel);
                if let Some(bp) = backup_path.parent() {
                    let _ = fs::create_dir_all(bp);
                }
                let _ = fs::copy(&dest_path, &backup_path);
            }
        }
    }

    let res = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("{}: {}", save.filename, e))?;
    let total = res.content_length().or(save.size).unwrap_or(0);
    let mut loaded: u64 = 0;
    let mut last_emit: u64 = 0;

    let mut file = fs::File::create(&dest_path).map_err(|e| format!("{}: {}", save.filename, e))?;

    let mut stream = res.bytes_stream();
    let mut write_err: Option<String> = None;
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let n = chunk.len() as u64;
                loaded += n;
                if loaded - last_emit >= DOWNLOAD_PROGRESS_EMIT_BYTES
                    || (total > 0 && loaded >= total)
                {
                    last_emit = loaded;
                    let _ = app.emit(
                        "sync-download-progress",
                        SyncProgressPayload {
                            game_id: game_id.to_string(),
                            filename: save.filename.clone(),
                            loaded,
                            total,
                        },
                    );
                }
                if file.write_all(&chunk).is_err() {
                    write_err = Some(format!("{}: error al escribir", save.filename));
                    break;
                }
            }
            Err(e) => {
                write_err = Some(format!("{}: {}", save.filename, e));
                break;
            }
        }
    }
    if total > 0 && loaded < total {
        let _ = app.emit(
            "sync-download-progress",
            SyncProgressPayload {
                game_id: game_id.to_string(),
                filename: save.filename.clone(),
                loaded: total,
                total,
            },
        );
    }
    match write_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn sync_download_game(
    game_id: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<SyncResultDto, String> {
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = sync_download_game_impl(game_id.clone(), app.clone()).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    let _ = app.emit("sync-download-done", ());
    result
}

async fn sync_download_game_impl(game_id: String, app: AppHandle) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::process_check::is_game_running(&game_id, &game.paths) {
        return Err(format!(
            "El juego está en ejecución. Cierra {} antes de descargar para evitar sobrescribir archivos en uso.",
            game.id
        ));
    }

    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta de destino".into()),
    };

    let all = api::sync_list_remote_saves().await?;
    let saves: Vec<_> = all
        .into_iter()
        .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
        .collect();

    if saves.is_empty() {
        let result = SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["No hay guardados de este juego en la nube".into()],
        };
        let _ = crate::config::append_operation_log(
            "download",
            &game_id,
            result.ok_count,
            result.err_count,
        );
        return Ok(result);
    }

    let items: Vec<(String, String)> = saves
        .iter()
        .map(|s| (game_id.clone(), s.key.clone()))
        .collect();

    const DOWNLOAD_URLS_BATCH_SIZE: usize = 500;
    let mut download_urls = Vec::with_capacity(saves.len());
    for chunk in items.chunks(DOWNLOAD_URLS_BATCH_SIZE) {
        let batch = api::get_download_urls(api_base, user_id, api_key, chunk)
            .await
            .map_err(|e| format!("download-urls: {}", e))?;
        download_urls.extend(batch);
    }
    if download_urls.len() != saves.len() {
        return Err(format!(
            "API devolvió {} URLs para {} archivos",
            download_urls.len(),
            saves.len()
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let backup_dir = crate::config::config_dir().map(|root| {
        let ts = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
        root.join("backups").join(&game_id).join(ts.to_string())
    });

    let results: Vec<Result<(), String>> = stream::iter(
        saves
            .into_iter()
            .zip(download_urls)
            .map(|(save, (download_url, _))| (save, download_url)),
    )
    .map(|(save, download_url)| {
        let client = client.clone();
        let dest_base = dest_base.clone();
        let backup_dir = backup_dir.clone();
        let game_id = game_id.clone();
        let app = app.clone();
        async move {
            download_one_file(
                &client,
                &dest_base,
                backup_dir.as_deref(),
                &save,
                &download_url,
                &game_id,
                &app,
            )
            .await
        }
    })
    .buffer_unordered(DOWNLOAD_FILE_CONCURRENCY)
    .collect()
    .await;

    let ok_count = results.iter().filter(|r| r.is_ok()).count() as u32;
    let errors: Vec<String> = results.into_iter().filter_map(|r| r.err()).collect();
    let err_count = errors.len() as u32;

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    let _ = crate::config::append_operation_log(
        "download",
        &game_id,
        result.ok_count,
        result.err_count,
    );

    if backup_dir.is_some() && result.err_count == 0 {
        let keep = cfg
            .keep_backups_per_game
            .unwrap_or(backup::DEFAULT_KEEP_BACKUPS_PER_GAME);
        let _ = backup::cleanup_old_backups(keep);
    }

    Ok(result)
}

/// Número de juegos que se descargan en paralelo en "descargar todos".
const DOWNLOAD_BATCH_CONCURRENCY: usize = 4;

/// Descarga los guardados de todos los juegos configurados (operación batch, varios juegos en paralelo).
#[tauri::command]
pub async fn sync_download_all_games(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<Vec<GameSyncResultDto>, String> {
    let cfg = crate::config::load_config();
    let _ = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let _ = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;

    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let mut results_by_id: HashMap<String, GameSyncResultDto> = HashMap::new();
    for game in &cfg.games {
        if crate::process_check::is_game_running(&game.id, &game.paths) {
            let game_id = game.id.clone();
            results_by_id.insert(
                game_id.clone(),
                GameSyncResultDto {
                    game_id,
                    result: SyncResultDto {
                        ok_count: 0,
                        err_count: 1,
                        errors: vec![format!(
                            "{} está en ejecución. Ciérralo antes de descargar.",
                            game.id
                        )],
                    },
                },
            );
        }
    }

    let to_download: Vec<String> = cfg
        .games
        .iter()
        .filter(|g| !results_by_id.contains_key(&g.id))
        .map(|g| g.id.clone())
        .collect();

    let completed: Vec<(String, Result<SyncResultDto, String>)> = stream::iter(to_download)
        .map(|game_id| {
            let app = app.clone();
            async move {
                let r = sync_download_game_impl(game_id.clone(), app).await;
                (game_id, r)
            }
        })
        .buffer_unordered(DOWNLOAD_BATCH_CONCURRENCY)
        .collect()
        .await;

    for (game_id, r) in completed {
        let result = match r {
            Ok(x) => x,
            Err(e) => SyncResultDto {
                ok_count: 0,
                err_count: 1,
                errors: vec![e],
            },
        };
        results_by_id.insert(game_id.clone(), GameSyncResultDto { game_id, result });
    }

    let results: Vec<GameSyncResultDto> = cfg
        .games
        .iter()
        .map(|g| results_by_id.get(&g.id).cloned().expect("result per game"))
        .collect();

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    let _ = app.emit("sync-download-done", ());

    let cfg = crate::config::load_config();
    let keep = cfg
        .keep_backups_per_game
        .unwrap_or(backup::DEFAULT_KEEP_BACKUPS_PER_GAME);
    let _ = backup::cleanup_old_backups(keep);

    Ok(results)
}
