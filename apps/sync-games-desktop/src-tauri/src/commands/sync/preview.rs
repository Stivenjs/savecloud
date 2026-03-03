//! Previsualización de sincronización (archivos, tamaño, conflictos).

use super::api;
use super::download;
use super::models::{PreviewDownloadDto, PreviewFileDto, PreviewUploadDto};
use super::path_utils;
use std::path::PathBuf;

/// Previsualiza qué archivos se subirían.
#[tauri::command]
pub fn preview_upload(game_id: String) -> Result<PreviewUploadDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

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

    Ok(PreviewUploadDto {
        file_count: preview_files.len() as u32,
        total_size_bytes: total_size,
        files: preview_files,
    })
}

/// Previsualiza qué archivos se descargarían y cuáles sobrescribirían locales más recientes.
#[tauri::command]
pub async fn preview_download(game_id: String) -> Result<PreviewDownloadDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta".into()),
    };

    let all = api::sync_list_remote_saves().await?;
    let saves: Vec<_> = all
        .into_iter()
        .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
        .collect();

    let conflicts_result = download::sync_check_download_conflicts(game_id.clone()).await?;

    let mut files = Vec::new();
    let mut total_size: u64 = 0;
    let conflict_keys: std::collections::HashSet<_> = conflicts_result
        .conflicts
        .iter()
        .map(|c| c.filename.as_str())
        .collect();

    for save in &saves {
        let local_newer = conflict_keys.contains(save.filename.as_str());
        total_size += save.size.unwrap_or(0);
        files.push(PreviewFileDto {
            filename: save.filename.clone(),
            size: save.size.unwrap_or(0),
            local_newer: if dest_base.join(&save.filename).exists() {
                Some(local_newer)
            } else {
                None
            },
        });
    }

    Ok(PreviewDownloadDto {
        file_count: files.len() as u32,
        total_size_bytes: total_size,
        files,
        conflict_count: conflicts_result.conflicts.len() as u32,
    })
}
