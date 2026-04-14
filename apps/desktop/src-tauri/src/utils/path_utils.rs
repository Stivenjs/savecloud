//! Utilidades para expandir rutas y listar archivos.

use regex::Regex;
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

    for raw in paths {
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
                let rel = expanded
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                results.push((abs, rel, mtime, meta.len()));
            }
        } else if meta.is_dir() {
            let mut files = Vec::new();
            collect_files_with_mtime(&expanded, &expanded, &mut files);

            for (abs_path, rel, mtime, size) in files {
                let abs = abs_path.to_string_lossy().to_string();
                if seen.insert(abs.clone()) {
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
