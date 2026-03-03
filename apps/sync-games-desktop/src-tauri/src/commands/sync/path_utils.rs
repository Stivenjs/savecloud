//! Utilidades para expandir rutas y listar archivos.

use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Expande %VAR% y ~ en rutas.
pub(crate) fn expand_path(raw: &str) -> Option<String> {
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
        Some(result)
    }
}

pub(crate) fn collect_files_with_mtime(
    dir: &Path,
    base: &Path,
    out: &mut Vec<(PathBuf, String, std::time::SystemTime, u64)>,
) {
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
                collect_files_with_mtime(&full, base, out);
            }
        } else if meta.is_file() {
            if let Ok(rel) = full.strip_prefix(base) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                out.push((full, rel_str, mtime, meta.len()));
            }
        }
    }
}

pub(crate) fn list_all_files_with_mtime(
    paths: &[String],
) -> Vec<(String, String, std::time::SystemTime, u64)> {
    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();

    for raw in paths {
        let expanded = match expand_path(raw.trim()) {
            Some(p) => PathBuf::from(p),
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
            let abs = expanded.to_string_lossy().to_string();
            if seen.insert(abs.clone()) {
                let rel = expanded
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
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

pub(crate) fn list_all_files_from_paths(paths: &[String]) -> Vec<(String, String)> {
    list_all_files_with_mtime(paths)
        .into_iter()
        .map(|(a, r, _, _)| (a, r))
        .collect()
}
