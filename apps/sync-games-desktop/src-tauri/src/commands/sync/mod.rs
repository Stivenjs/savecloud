//! Sincronización de guardados: subir y descargar a/desde la API (S3).
//!
//! Este módulo está dividido en sub módulos siguiendo las convenciones de Rust:
//! - `path_utils`: Utilidades para expandir rutas y listar archivos
//! - `models`: DTOs compartidos
//! - `api`: Cliente HTTP para la API
//! - `backup`: Backups locales
//! - `preview`: Previsualización de sync
//! - `upload`: Subida de guardados
//! - `download`: Descarga y conflictos

pub(crate) mod api;
pub(crate) mod backup;
pub(crate) mod download;
mod models;
mod path_utils;
pub(crate) mod preview;
pub(crate) mod upload;

use models::SaveFileDto;

pub use api::sync_list_remote_saves;
pub use upload::sync_upload_game;

/// Lista archivos de guardado de un juego configurado.
#[tauri::command]
pub async fn list_save_files(game_id: String) -> Result<Vec<SaveFileDto>, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let files = path_utils::list_all_files_from_paths(&game.paths);
    Ok(files
        .into_iter()
        .map(|(absolute, relative)| SaveFileDto { absolute, relative })
        .collect())
}

/// Comprueba si el juego está en ejecución (para mostrar advertencia en la UI).
#[tauri::command]
pub fn check_game_running(game_id: String) -> bool {
    let cfg = crate::config::load_config();
    let Some(game) = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
    else {
        return false;
    };
    crate::process_check::is_game_running(&game_id, &game.paths)
}
