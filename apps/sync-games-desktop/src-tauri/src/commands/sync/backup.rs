//! Backups locales: listar y restaurar.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::models::{BackupInfoDto, SyncResultDto};
use super::path_utils;

fn count_files_recursive(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0u32;
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            count += count_files_recursive(&p);
        } else {
            count += 1;
        }
    }
    count
}

fn copy_recursive_to(
    src_root: &Path,
    src: &Path,
    dest_base: &Path,
    ok_count: &mut u32,
    errors: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(src) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        let rel = path.strip_prefix(src_root).ok();
        let Some(rel) = rel else {
            continue;
        };
        let dest_path = dest_base.join(rel);
        if path.is_dir() {
            let _ = fs::create_dir_all(&dest_path);
            copy_recursive_to(src_root, &path, dest_base, ok_count, errors);
        } else if path.is_file() {
            match fs::copy(&path, &dest_path) {
                Ok(_) => *ok_count += 1,
                Err(e) => {
                    errors.push(format!("{}: {}", rel.display(), e));
                }
            }
        }
    }
}

/// Lista los backups locales disponibles para un juego.
#[tauri::command]
pub fn list_backups(game_id: String) -> Result<Vec<BackupInfoDto>, String> {
    let cfg = crate::config::load_config();
    let _ = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let backup_root = crate::config::config_dir()
        .ok_or("No se pudo obtener directorio de configuración")?
        .join("backups")
        .join(&game_id);

    if !backup_root.exists() || !backup_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut backups = Vec::new();
    let entries = fs::read_dir(&backup_root).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }

        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        let created = meta
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(UNIX_EPOCH).ok().and_then(|d| {
                    chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                })
            })
            .unwrap_or_else(chrono::Utc::now);
        let created_at = created.format("%Y-%m-%d %H:%M").to_string();

        let file_count = count_files_recursive(&path);

        backups.push(BackupInfoDto {
            id,
            created_at,
            file_count,
        });
    }

    backups.sort_by(|a, b| b.id.cmp(&a.id)); // más reciente primero
    Ok(backups)
}

/// Restaura un backup local sobre los guardados del juego.
#[tauri::command]
pub fn restore_backup(game_id: String, backup_id: String) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::process_check::is_game_running(&game_id, &game.paths) {
        return Err(format!(
            "El juego está en ejecución. Cierra {} antes de restaurar.",
            game.id
        ));
    }

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => std::path::PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta del juego".into()),
    };

    let backup_dir = crate::config::config_dir()
        .ok_or("No se pudo obtener directorio de configuración")?
        .join("backups")
        .join(&game_id)
        .join(&backup_id);

    if !backup_dir.exists() || !backup_dir.is_dir() {
        return Err(format!("Backup no encontrado: {}", backup_id));
    }

    let mut ok_count = 0u32;
    let mut errors = Vec::new();

    copy_recursive_to(
        &backup_dir,
        &backup_dir,
        &dest_base,
        &mut ok_count,
        &mut errors,
    );

    Ok(SyncResultDto {
        ok_count,
        err_count: errors.len() as u32,
        errors,
    })
}
