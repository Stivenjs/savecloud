//! Estadísticas por juego: tamaño en disco, última modificación local, en la nube y tiempo de juego.

use crate::commands::sync;
use crate::config;
use futures_util::future::join_all;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatsDto {
    pub game_id: String,
    pub local_size_bytes: u64,
    pub local_last_modified: Option<String>,
    pub cloud_last_modified: Option<String>,
    pub playtime_seconds: u64,
}

/// Expande variables de entorno como %APPDATA% o ~ en rutas.
fn expand_path(raw: &str) -> Option<PathBuf> {
    let mut result = raw.to_string();
    let re = Regex::new(r"%([^%]+)%").ok()?;
    for cap in re.captures_iter(raw) {
        let var = cap.get(1)?.as_str();
        let val = std::env::var(var).unwrap_or_default();
        result = result.replace(&format!("%{}%", var), &val);
    }
    if result.starts_with('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            let rest = result.trim_start_matches('~').trim_start_matches('/');
            result = if rest.is_empty() {
                home
            } else {
                format!("{}/{}", home.trim_end_matches(&['/', '\\']), rest)
            };
        }
    }
    if result.is_empty() {
        None
    } else {
        Some(PathBuf::from(result))
    }
}

/// Recorre directorios para sumar tamaños y encontrar la fecha más reciente.
fn collect_files_with_meta(dir: &Path, base: &Path, out: &mut Vec<(u64, std::time::SystemTime)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let full = e.path();
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            if !e.file_name().to_string_lossy().starts_with('.') {
                collect_files_with_meta(&full, base, out);
            }
        } else if meta.is_file() {
            if full.strip_prefix(base).is_ok() {
                let size = meta.len();
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                out.push((size, mtime));
            }
        }
    }
}

/// Calcula estadísticas locales para una lista de rutas de un juego.
fn local_stats_for_paths(paths: &[String]) -> (u64, Option<std::time::SystemTime>) {
    let mut total_size = 0u64;
    let mut max_mtime: Option<std::time::SystemTime> = None;

    for raw in paths {
        let expanded = match expand_path(raw.trim()) {
            Some(p) => p,
            None => continue,
        };
        if !expanded.exists() {
            continue;
        }
        let meta = match fs::metadata(&expanded) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_file() {
            total_size += meta.len();
            if let Ok(mtime) = meta.modified() {
                max_mtime = Some(match max_mtime {
                    Some(prev) if mtime > prev => mtime,
                    Some(prev) => prev,
                    None => mtime,
                });
            }
        } else if meta.is_dir() {
            let mut files = Vec::new();
            collect_files_with_meta(&expanded, &expanded, &mut files);
            for (size, mtime) in files {
                total_size += size;
                max_mtime = Some(match max_mtime {
                    Some(prev) if mtime > prev => mtime,
                    Some(prev) => prev,
                    None => mtime,
                });
            }
        }
    }

    (total_size, max_mtime)
}

#[tauri::command]
pub async fn get_game_stats() -> Result<Vec<GameStatsDto>, String> {
    let cfg = config::load_config();

    let playtime_map: HashMap<String, u64> = cfg
        .games
        .iter()
        .map(|g| (g.id.to_lowercase(), g.playtime_seconds))
        .collect();

    let cloud_by_game: HashMap<String, Option<String>> = match sync::sync_list_remote_saves().await
    {
        Ok(remote) => {
            let mut map: HashMap<String, Option<chrono::DateTime<chrono::Utc>>> = HashMap::new();
            for s in remote {
                let dt = chrono::DateTime::parse_from_rfc3339(&s.last_modified)
                    .or_else(|_| chrono::DateTime::parse_from_rfc2822(&s.last_modified))
                    .ok()
                    .map(|d| d.with_timezone(&chrono::Utc));

                if let Some(new_dt) = dt {
                    let key = s.game_id.to_lowercase();
                    let entry = map.entry(key).or_insert(None);
                    *entry = Some(match *entry {
                        Some(prev) if new_dt > prev => new_dt,
                        Some(prev) => prev,
                        None => new_dt,
                    });
                }
            }
            map.into_iter()
                .map(|(k, v)| (k, v.map(|d| d.to_rfc3339())))
                .collect()
        }
        Err(_) => HashMap::new(),
    };

    let mut handles = Vec::with_capacity(cfg.games.len());
    for game in &cfg.games {
        let id = game.id.clone();
        let paths = game.paths.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            let (local_size, local_mtime) = local_stats_for_paths(&paths);
            (id, local_size, local_mtime)
        }));
    }

    let joined = join_all(handles).await;
    let mut result = Vec::with_capacity(joined.len());

    for join_res in joined {
        let (game_id, local_size, local_mtime) =
            join_res.map_err(|e| format!("Error en tarea de estadísticas: {}", e))?;

        let local_last_modified = local_mtime.and_then(|mtime| {
            let Ok(duration) = mtime.duration_since(UNIX_EPOCH) else {
                return None;
            };
            chrono::DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
                .map(|d| d.to_rfc3339())
        });

        let key_lower = game_id.to_lowercase();

        let cloud_last_modified = cloud_by_game.get(&key_lower).cloned().flatten();

        let playtime_seconds = playtime_map.get(&key_lower).cloned().unwrap_or(0);

        result.push(GameStatsDto {
            game_id,
            local_size_bytes: local_size,
            local_last_modified,
            cloud_last_modified,
            playtime_seconds,
        });
    }

    Ok(result)
}
