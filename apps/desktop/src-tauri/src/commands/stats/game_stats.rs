//! Módulo de cálculo de estadísticas por juego.
//!
//! Contiene las estructuras de datos y funciones para:
//!
//! - Obtener las estadísticas por juego.
//! - Expandir variables de entorno en rutas.
//! - Recorrer directorios para sumar tamaños y encontrar la fecha más reciente.
//! - Calcular estadísticas locales para una lista de rutas de un juego.

use crate::commands::sync;
use crate::commands::sync::full_backup;
use crate::config;
use crate::config::OperationLogEntry;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGraphNodeDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub metric: Option<String>,
    pub status: Option<String>,
    pub tone: String,
    pub timestamp: Option<String>,
    pub game_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGraphEdgeDto {
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: String,
    #[serde(default)]
    pub animated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSaveGraphDto {
    pub scope: String,
    pub game_id: String,
    pub title: String,
    pub subtitle: String,
    pub generated_at: String,
    pub nodes: Vec<SaveGraphNodeDto>,
    pub edges: Vec<SaveGraphEdgeDto>,
}

fn parse_timestamp(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .or_else(|_| chrono::DateTime::parse_from_rfc2822(value))
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

fn format_tone(kind: &str) -> &'static str {
    match kind {
        "biblioteca" => "indigo",
        "juego" => "emerald",
        "actividad" => "slate",
        "respaldo" => "amber",
        "resumen" => "rose",
        _ => "slate",
    }
}

fn operation_label(kind: &str) -> &'static str {
    match kind.to_ascii_lowercase().as_str() {
        "upload" => "Subida",
        "download" => "Descarga",
        "copy_friend" => "Copia de amigo",
        _ => "Actividad",
    }
}

fn operation_status(entry: &OperationLogEntry) -> &'static str {
    if entry.err_count > 0 {
        "Con errores"
    } else {
        "Correcto"
    }
}

fn build_game_node(
    game_id: &str,
    title: String,
    subtitle: String,
    metric: String,
) -> SaveGraphNodeDto {
    SaveGraphNodeDto {
        id: format!("juego:{}", game_id),
        kind: "juego".to_string(),
        title,
        subtitle: Some(subtitle),
        metric: Some(metric),
        status: Some("Nodo principal".to_string()),
        tone: format_tone("juego").to_string(),
        timestamp: None,
        game_id: Some(game_id.to_string()),
    }
}

fn build_operation_node(
    game_id: &str,
    index: usize,
    entry: &OperationLogEntry,
) -> SaveGraphNodeDto {
    SaveGraphNodeDto {
        id: format!("actividad:{}:{}", game_id, index),
        kind: "actividad".to_string(),
        title: operation_label(&entry.kind).to_string(),
        subtitle: Some(format!(
            "{} archivos · {}",
            entry.file_count,
            operation_status(entry)
        )),
        metric: Some(entry.timestamp.clone()),
        status: Some(operation_status(entry).to_string()),
        tone: format_tone("actividad").to_string(),
        timestamp: Some(entry.timestamp.clone()),
        game_id: Some(game_id.to_string()),
    }
}

fn build_backup_node(
    game_id: &str,
    key: &str,
    title: String,
    subtitle: String,
    metric: String,
    timestamp: String,
) -> SaveGraphNodeDto {
    SaveGraphNodeDto {
        id: format!("respaldo:{}:{}", game_id, key),
        kind: "respaldo".to_string(),
        title,
        subtitle: Some(subtitle),
        metric: Some(metric),
        status: Some("Respaldo completo".to_string()),
        tone: format_tone("respaldo").to_string(),
        timestamp: Some(timestamp),
        game_id: Some(game_id.to_string()),
    }
}

fn build_edge(source: &str, target: &str, relation: &str, animated: bool) -> SaveGraphEdgeDto {
    SaveGraphEdgeDto {
        id: format!("{}->{}:{}", source, target, relation),
        source: source.to_string(),
        target: target.to_string(),
        relation: relation.to_string(),
        animated,
    }
}

async fn build_game_save_graph(game_id: &str) -> Result<GameSaveGraphDto, String> {
    let cfg = config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let history = config::load_history();
    let mut operations: Vec<OperationLogEntry> = history
        .entries
        .into_iter()
        .filter(|e| e.game_id.eq_ignore_ascii_case(game_id))
        .collect();
    operations.sort_by(|a, b| {
        let a_dt = parse_timestamp(&a.timestamp)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let b_dt = parse_timestamp(&b.timestamp)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        a_dt.cmp(&b_dt)
    });

    let backups = full_backup::list_full_backups(game_id.to_string()).await?;

    let root_id = format!("juego:{}", game_id);
    let game_title = game
        .edition_label
        .as_ref()
        .filter(|v| !v.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| game.id.clone());
    let mut nodes = vec![build_game_node(
        game_id,
        game_title,
        "Vista detallada de guardados".to_string(),
        format!("{} eventos", operations.len()),
    )];
    let mut edges = Vec::new();

    let mut previous_operation_id: Option<String> = None;
    for (index, entry) in operations.iter().enumerate() {
        let node = build_operation_node(game_id, index, entry);
        let node_id = node.id.clone();
        nodes.push(node);
        edges.push(build_edge(&root_id, &node_id, "cronología", index % 2 == 0));

        if let Some(previous_id) = previous_operation_id.as_ref() {
            edges.push(build_edge(previous_id, &node_id, "cronología", true));
        }
        previous_operation_id = Some(node_id);
    }

    let operation_lookup: Vec<(String, chrono::DateTime<chrono::Utc>)> = operations
        .iter()
        .filter_map(|entry| {
            parse_timestamp(&entry.timestamp).map(|dt| (entry.timestamp.clone(), dt))
        })
        .collect();

    for backup in backups {
        let backup_dt = parse_timestamp(&backup.last_modified).unwrap_or_else(chrono::Utc::now);
        let node = build_backup_node(
            game_id,
            &backup.key,
            "Respaldo completo".to_string(),
            backup.filename.clone(),
            backup
                .size
                .map(|size| format!("{:.1} MB", size as f64 / (1024.0 * 1024.0)))
                .unwrap_or_else(|| "Tamaño desconocido".to_string()),
            backup.last_modified,
        );
        let node_id = node.id.clone();
        nodes.push(node);
        edges.push(build_edge(&root_id, &node_id, "respaldo", false));

        if let Some((_, nearest_dt)) = operation_lookup
            .iter()
            .rev()
            .find(|(_, dt)| *dt <= backup_dt)
        {
            if let Some(operation_node) =
                operations.iter().enumerate().find_map(|(index, entry)| {
                    parse_timestamp(&entry.timestamp).and_then(|dt| {
                        if dt.timestamp() == nearest_dt.timestamp() {
                            Some(format!("actividad:{}:{}", game_id, index))
                        } else {
                            None
                        }
                    })
                })
            {
                edges.push(build_edge(&operation_node, &node_id, "respaldo", false));
            }
        }
    }

    Ok(GameSaveGraphDto {
        scope: "juego".to_string(),
        game_id: game_id.to_string(),
        title: game.id.clone(),
        subtitle: "Datos y backups del juego".to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        nodes,
        edges,
    })
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
                format!("{}/{}", home.trim_end_matches(['/', '\\']), rest)
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
        let file_name = e.file_name();
        let fname_str = file_name.to_string_lossy();

        if fname_str.starts_with('.') {
            continue;
        }

        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let full = e.path();
        if meta.is_dir() {
            collect_files_with_meta(&full, base, out);
        } else if meta.is_file() {
            let size = meta.len();
            let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
            out.push((size, mtime));
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

    let cloud_by_game: HashMap<String, Option<String>> =
        match sync::api::sync_list_remote_saves_summary().await {
            Ok(remote) => {
                let mut map: HashMap<String, Option<chrono::DateTime<chrono::Utc>>> =
                    HashMap::new();
                for s in remote {
                    let dt = match s.last_modified.as_deref() {
                        Some(val) => chrono::DateTime::parse_from_rfc3339(val)
                            .or_else(|_| chrono::DateTime::parse_from_rfc2822(val))
                            .ok()
                            .map(|d| d.with_timezone(&chrono::Utc)),
                        None => None,
                    };

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

/// Devuelve el mapa visual de guardados de un juego concreto.
#[tauri::command]
pub async fn get_game_save_graph(game_id: String) -> Result<GameSaveGraphDto, String> {
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return Err("El gameId no puede estar vacío".to_string());
    }
    build_game_save_graph(game_id).await
}
