//! Módulo de previsualización de sincronización de archivos.

use super::api;
use super::download;
use super::models::{PreviewDownloadDto, PreviewFileDto, PreviewUploadDto};
use crate::utils::path_utils;

/// Previsualiza qué archivos se subirían para un juego.
///
/// Se marca `async` para no bloquear el hilo principal de Tauri mientras
/// `list_all_files_with_mtime` recorre el sistema de archivos. El trabajo
/// pesado se delega a `tokio::task::spawn_blocking` para que corra en el
/// threadpool de bloqueo sin interferir con el executor async.
#[tauri::command]
pub async fn preview_upload(game_id: String) -> Result<PreviewUploadDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?
        .clone();

    let result = tokio::task::spawn_blocking(move || {
        let files = path_utils::list_all_files_with_mtime(&game.paths);
        let total_size: u64 = files.iter().map(|(_, _, _, s)| s).sum();
        let preview_files: Vec<PreviewFileDto> = files
            .into_iter()
            .map(|(_, rel, _, size)| PreviewFileDto {
                filename: rel,
                size,
                local_newer: None,
            })
            .collect();

        PreviewUploadDto {
            file_count: preview_files.len() as u32,
            total_size_bytes: total_size,
            files: preview_files,
        }
    })
    .await
    .map_err(|e| format!("Error en tarea de preview: {e}"))?;

    Ok(result)
}

/// Previsualiza qué archivos se descargarían y cuáles conflictuarían con locales más recientes.
#[tauri::command]
pub async fn preview_download(game_id: String) -> Result<PreviewDownloadDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?
        .clone();

    // Lanza ambas operaciones de red en paralelo en vez de secuencial,
    // reduciendo la latencia total a max(t_saves, t_conflicts) en vez de su suma.
    let (saves_result, conflicts_result) = tokio::try_join!(
        api::sync_list_remote_saves_for_game(game_id.clone()),
        download::sync_check_download_conflicts(game_id.clone()),
    )?;

    let conflict_keys: std::collections::HashSet<&str> = conflicts_result
        .conflicts
        .iter()
        .map(|c| c.filename.as_str())
        .collect();

    let mut total_size: u64 = 0;
    let files: Vec<PreviewFileDto> = saves_result
        .iter()
        .map(|save| {
            let local_newer = conflict_keys.contains(save.filename.as_str());
            total_size += save.size.unwrap_or(0);
            PreviewFileDto {
                filename: save.filename.clone(),
                size: save.size.unwrap_or(0),
                local_newer: if path_utils::sync_abs_path_for_cloud_save(
                    &game.paths,
                    &save.filename,
                )
                .as_ref()
                .is_some_and(|p| p.exists())
                {
                    Some(local_newer)
                } else {
                    None
                },
            }
        })
        .collect();

    Ok(PreviewDownloadDto {
        file_count: files.len() as u32,
        total_size_bytes: total_size,
        files,
        conflict_count: conflicts_result.conflicts.len() as u32,
    })
}
