//! Utilidades para expandir rutas y listar archivos.

use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;

static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());

/// Expande %VAR% y ~ en rutas.
pub fn expand_path(raw: &str) -> Option<String> {
    let mut result = raw.to_string();

    for cap in ENV_VAR_REGEX.captures_iter(raw) {
        if let Some(var) = cap.get(1) {
            let var_str = var.as_str();
            if let Ok(val) = std::env::var(var_str) {
                result = result.replace(&format!("%{}%", var_str), &val);
            }
        }
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
        Some(result)
    }
}

/// Segmento válido como prefijo de clave en almacenamiento de objetos (sin `/`).
fn sanitize_cloud_path_segment(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let t = cleaned.trim().trim_matches('.').to_string();
    if t.is_empty() {
        "root".into()
    } else {
        t
    }
}

/// Carpetilla “visible” configurada por el usuario: último componente de la ruta (archivo o directorio).
fn sync_leaf_name_for_game_path(raw: &str, root_index: usize) -> String {
    let fallback = format!("root{}", root_index + 1);
    let Some(expanded_str) = expand_path(raw.trim()) else {
        return sanitize_cloud_path_segment(&fallback);
    };
    let pb = PathBuf::from(&expanded_str);
    let Some(fname) = pb.file_name() else {
        return sanitize_cloud_path_segment(&fallback);
    };
    let raw_name = fname.to_string_lossy();
    let trimmed = raw_name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return sanitize_cloud_path_segment(&fallback);
    }
    sanitize_cloud_path_segment(trimmed)
}

/// Prefijos remotos únicos (`nombre/`) por cada ruta cuando el juego tiene varias bases.
///
/// Prioriza el **nombre real** de la carpeta (último segmento tras expandir). Si dos rutas comparten nombre
/// sanitizado, la segunda usa `nombre-2`, la tercera `nombre-3`, etc.
pub fn compute_sync_multi_root_prefixes(paths: &[String]) -> Vec<String> {
    if paths.len() <= 1 {
        return Vec::new();
    }

    let sanitized: Vec<String> = paths
        .iter()
        .enumerate()
        .map(|(i, p)| sync_leaf_name_for_game_path(p, i))
        .collect();

    let mut tally: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::with_capacity(paths.len());
    for label in sanitized {
        let n = tally.entry(label.clone()).or_insert(0);
        let segment = if *n == 0 {
            label.clone()
        } else {
            format!("{}-{}", label, *n + 1)
        };
        *n += 1;
        out.push(format!("{}/", segment.replace('/', "_").replace('\\', "_")));
    }
    out
}

/// Resuelve la ruta absoluta local donde debe escribirse un objeto listado como `remote_filename`
/// (`filename` desde la API, normalmente después de `{user}/{gameId}/`).
///
/// Una sola ruta: igual que antes (`base / remote`).
/// Varias rutas: prefijos por nombre de carpeta [`compute_sync_multi_root_prefixes`], más legado `sync-root-{i}/`.
/// Sin prefijo reconocido y varias rutas: plano sobre `paths[0]` (datos muy antiguos).
pub fn sync_abs_path_for_cloud_save(
    game_paths: &[String],
    remote_filename: &str,
) -> Option<PathBuf> {
    if game_paths.is_empty() {
        return None;
    }
    let rf = remote_filename.trim().trim_start_matches(['/', '\\']);
    if rf.is_empty() {
        return None;
    }

    fn join_logical_base(base_norm: PathBuf, tail: &str) -> PathBuf {
        let tail = tail.trim_matches(['/', '\\']);
        let mut pb = base_norm;
        if tail.is_empty() {
            return pb;
        }
        for seg in tail
            .split(|c| c == '/' || c == '\\')
            .filter(|s| !s.is_empty())
        {
            pb.push(seg);
        }
        pb
    }

    if game_paths.len() == 1 {
        let b = expand_path(game_paths[0].trim())?;
        return Some(join_logical_base(PathBuf::from(b), rf));
    }

    // Prefijos más largos primero por si un nombre es prefijo del otro.
    fn longest_prefix_match<'a>(
        rf: &'a str,
        prefs: &[(usize, String)],
    ) -> Option<(usize, &'a str)> {
        let mut best: Option<(usize, &'a str, usize)> = None;
        for &(idx, ref pref) in prefs {
            if rf.starts_with(pref.as_str()) {
                let len = pref.len();
                if best.map_or(true, |(_, _, l)| len > l) {
                    best = Some((idx, &rf[len..], len));
                }
            }
        }
        best.map(|(i, tail, _)| (i, tail))
    }

    let mut keyed: Vec<(usize, String)> = Vec::new();
    let folder_prefs = compute_sync_multi_root_prefixes(game_paths);
    for (i, p) in folder_prefs.into_iter().enumerate() {
        keyed.push((i, p));
    }
    for i in 0..game_paths.len() {
        keyed.push((i, format!("sync-root-{}/", i)));
    }

    let (idx, tail) = match longest_prefix_match(rf, &keyed) {
        Some((i, tail)) => (i, tail),
        None => {
            // Retrocompatibilidad con datos sin prefijo multi-raíz.
            (0usize, rf)
        }
    };
    let base = expand_path(game_paths[idx].trim())?;
    Some(join_logical_base(PathBuf::from(base), tail))
}

pub fn collect_files_with_mtime(
    dir: &Path,
    base: &Path,
    out: &mut Vec<(PathBuf, String, std::time::SystemTime, u64)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for e in entries.flatten() {
        if e.file_name().to_str().map_or(false, |s| s.starts_with('.')) {
            continue;
        }

        let full = e.path();
        let Ok(meta) = e.metadata() else {
            continue;
        };

        if meta.is_dir() {
            collect_files_with_mtime(&full, base, out);
        } else if meta.is_file() {
            if let Ok(rel) = full.strip_prefix(base) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                out.push((full, rel_str, mtime, meta.len()));
            }
        }
    }
}

pub fn list_all_files_with_mtime(
    paths: &[String],
) -> Vec<(String, String, std::time::SystemTime, u64)> {
    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    let folder_prefixes = compute_sync_multi_root_prefixes(paths);

    for (root_idx, raw) in paths.iter().enumerate() {
        let prefix = folder_prefixes.get(root_idx).cloned().unwrap_or_default();

        let Some(expanded_str) = expand_path(raw.trim()) else {
            continue;
        };
        let expanded = PathBuf::from(expanded_str);

        let Ok(meta) = fs::metadata(&expanded) else {
            continue;
        };

        if meta.is_file() {
            let abs = expanded.to_string_lossy().to_string();
            if seen.insert(abs.clone()) {
                let name = expanded
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();
                let rel = format!("{prefix}{name}");
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                results.push((abs, rel, mtime, meta.len()));
            }
        } else if meta.is_dir() {
            let mut files = Vec::new();
            collect_files_with_mtime(&expanded, &expanded, &mut files);

            for (abs_path, rel, mtime, size) in files {
                let abs = abs_path.to_string_lossy().to_string();
                if seen.insert(abs.clone()) {
                    let rel = format!("{prefix}{rel}");
                    results.push((abs, rel, mtime, size));
                }
            }
        }
    }

    results
}

pub fn list_all_files_from_paths(paths: &[String]) -> Vec<(String, String)> {
    list_all_files_with_mtime(paths)
        .into_iter()
        .map(|(a, r, _, _)| (a, r))
        .collect()
}
