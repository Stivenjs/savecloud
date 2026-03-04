//! Subida de guardados a la nube.

use std::fs;

use super::api;
use super::models::SyncResultDto;
use super::path_utils;
use crate::tray_state::TrayState;
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

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();

    for (absolute, relative) in files {
        // 1. Obtener URL de subida
        let body = serde_json::json!({
            "gameId": game_id,
            "filename": relative
        });
        let res = api::api_request(
            api_base,
            user_id,
            api_key,
            "POST",
            "/upload-url",
            Some(body.to_string().as_bytes()),
        )
        .await
        .map_err(|e| format!("upload-url: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            errors.push(format!("{}: {} ({})", relative, status, text));
            err_count += 1;
            continue;
        }

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let upload_url = json
            .get("uploadUrl")
            .and_then(|v| v.as_str())
            .ok_or("API no devolvió uploadUrl")?;

        // 2. Leer archivo y subir
        let bytes = fs::read(&absolute).map_err(|e| format!("{}: {}", relative, e))?;
        let put_res = client
            .put(upload_url)
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
