//! Descarga de guardados desde la nube.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Utc};

use super::api;
use super::models::{
    DownloadConflictDto, DownloadConflictsResultDto, GameConflictsResultDto, GameSyncResultDto,
    RemoteSaveInfoDto, SyncResultDto, UnsyncedGameDto,
};
use super::path_utils;
use crate::tray_state::TrayState;
use tauri::State;

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

#[tauri::command]
pub async fn sync_download_game(
    game_id: String,
    tray_state: State<'_, TrayState>,
) -> Result<SyncResultDto, String> {
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = sync_download_game_impl(game_id.clone()).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    result
}

async fn sync_download_game_impl(game_id: String) -> Result<SyncResultDto, String> {
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

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();

    let backup_dir = crate::config::config_dir().map(|root| {
        let ts = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
        root.join("backups").join(&game_id).join(ts.to_string())
    });

    for save in saves {
        let body = serde_json::json!({
            "gameId": game_id,
            "key": save.key
        });
        let res = api::api_request(
            api_base,
            user_id,
            api_key,
            "POST",
            "/download-url",
            Some(body.to_string().as_bytes()),
        )
        .await
        .map_err(|e| format!("download-url: {}", e))?;

        if !res.status().is_success() {
            errors.push(format!("{}: {}", save.filename, res.status()));
            err_count += 1;
            continue;
        }

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let download_url = json
            .get("downloadUrl")
            .and_then(|v| v.as_str())
            .ok_or("API no devolvió downloadUrl")?;

        let bytes = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("{}: {}", save.filename, e))?
            .bytes()
            .await
            .map_err(|e| format!("{}: {}", save.filename, e))?;

        let dest_path = dest_base.join(&save.filename);
        if let Some(parent) = dest_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        // Respaldo local antes de sobrescribir
        if dest_path.exists() {
            if let Some(ref backup_base) = backup_dir {
                if let Ok(rel) = dest_path.strip_prefix(&dest_base) {
                    let backup_path = backup_base.join(rel);
                    if let Some(bp) = backup_path.parent() {
                        let _ = fs::create_dir_all(bp);
                    }
                    let _ = fs::copy(&dest_path, &backup_path);
                }
            }
        }
        match fs::File::create(&dest_path).and_then(|mut f| f.write_all(&bytes)) {
            Ok(_) => ok_count += 1,
            Err(e) => {
                errors.push(format!("{}: {}", save.filename, e));
                err_count += 1;
            }
        }
    }

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

    Ok(result)
}

/// Descarga los guardados de todos los juegos configurados (operación batch).
#[tauri::command]
pub async fn sync_download_all_games(
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

    let mut results = Vec::with_capacity(cfg.games.len());
    for game in &cfg.games {
        let game_id = game.id.clone();
        let result = if crate::process_check::is_game_running(&game_id, &game.paths) {
            SyncResultDto {
                ok_count: 0,
                err_count: 1,
                errors: vec![format!(
                    "{} está en ejecución. Ciérralo antes de descargar.",
                    game_id
                )],
            }
        } else {
            match sync_download_game_impl(game_id.clone()).await {
                Ok(r) => r,
                Err(e) => SyncResultDto {
                    ok_count: 0,
                    err_count: 1,
                    errors: vec![e],
                },
            }
        };
        results.push(GameSyncResultDto {
            game_id: game_id.clone(),
            result,
        });
    }

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    Ok(results)
}
