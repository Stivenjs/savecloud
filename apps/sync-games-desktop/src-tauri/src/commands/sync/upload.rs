//! Subida de guardados a la nube.

use std::collections::HashMap;
use std::fs;

use super::api;
use super::models::{GameSyncResultDto, SyncResultDto};
use super::path_utils;
use crate::tray_state::TrayState;
use futures_util::stream::{self, StreamExt};
use tauri::State;

#[tauri::command]
pub async fn sync_upload_game(
    game_id: String,
    tray_state: State<'_, TrayState>,
) -> Result<SyncResultDto, String> {
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = sync_upload_game_impl(game_id).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    result
}

pub(crate) async fn sync_upload_game_impl(game_id: String) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::process_check::is_game_running(&game_id, &game.paths) {
        return Err(format!(
            "El juego está en ejecución. Cierra {} antes de sincronizar para evitar archivos bloqueados.",
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

    let files = path_utils::list_all_files_from_paths(&game.paths);
    if files.is_empty() {
        return Ok(SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["No se encontraron archivos en las rutas del juego".into()],
        });
    }

    let filenames: Vec<String> = files.iter().map(|(_, r)| r.clone()).collect();
    let upload_urls = api::get_upload_urls(api_base, user_id, api_key, &game_id, &filenames)
        .await
        .map_err(|e| format!("upload-urls: {}", e))?;
    if upload_urls.len() != files.len() {
        return Err(format!(
            "API devolvió {} URLs para {} archivos",
            upload_urls.len(),
            files.len()
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();

    for ((absolute, relative), (upload_url, _)) in files.into_iter().zip(upload_urls) {
        let bytes = fs::read(&absolute).map_err(|e| format!("{}: {}", relative, e))?;
        let put_res = client
            .put(&upload_url)
            .body(bytes)
            .header("Content-Type", "application/octet-stream")
            .send()
            .await
            .map_err(|e| format!("{}: {}", relative, e))?;

        if !put_res.status().is_success() {
            errors.push(format!("{}: S3 PUT {}", relative, put_res.status()));
            err_count += 1;
        } else {
            ok_count += 1;
        }
    }

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    // Registrar en historial (errores o éxito).
    let _ =
        crate::config::append_operation_log("upload", &game_id, result.ok_count, result.err_count);

    Ok(result)
}

/// Número de juegos que se suben en paralelo en "subir todos".
const UPLOAD_BATCH_CONCURRENCY: usize = 4;

/// Sube los guardados de todos los juegos configurados (operación batch, varios juegos en paralelo).
#[tauri::command]
pub async fn sync_upload_all_games(
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
                            "{} está en ejecución. Ciérralo antes de sincronizar.",
                            game.id
                        )],
                    },
                },
            );
        }
    }

    let to_sync: Vec<String> = cfg
        .games
        .iter()
        .filter(|g| !results_by_id.contains_key(&g.id))
        .map(|g| g.id.clone())
        .collect();

    let completed: Vec<(String, Result<SyncResultDto, String>)> = stream::iter(to_sync)
        .map(|game_id| async move {
            let r = sync_upload_game_impl(game_id.clone()).await;
            (game_id, r)
        })
        .buffer_unordered(UPLOAD_BATCH_CONCURRENCY)
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

    Ok(results)
}
