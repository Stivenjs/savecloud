//! Extensiones, patrones y exclusiones para detectar carpetas de guardados.
//! Réplica la lógica del CLI (FileSystemPathScanner).

use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use super::extensions::{
    save_folder_names, save_name_hints, strong_save_extensions, weak_save_extensions,
};

#[derive(Deserialize)]
struct ExclusionsData {
    excluded_folder_names: Vec<String>,
    excluded_partial_patterns: Vec<String>,
    generic_inner_folders: Vec<String>,
}

static EXCLUSIONS_DATA: LazyLock<ExclusionsData> = LazyLock::new(|| {
    let json_data = include_str!("data/exclusions.json");
    serde_json::from_str(json_data).expect("Error al parsear data/exclusions.json")
});

pub(super) static EXCLUDED_FOLDER_NAMES: LazyLock<HashSet<String>> = LazyLock::new(|| {
    EXCLUSIONS_DATA
        .excluded_folder_names
        .iter()
        .map(|s| s.to_lowercase())
        .collect()
});

pub(super) static GENERIC_INNER_FOLDERS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    EXCLUSIONS_DATA
        .generic_inner_folders
        .iter()
        .map(|s| s.to_lowercase())
        .collect()
});

pub(super) fn excluded_partial_patterns() -> &'static [String] {
    &EXCLUSIONS_DATA.excluded_partial_patterns
}

pub(super) fn is_strong_save_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    strong_save_extensions()
        .iter()
        .any(|ext| lower.ends_with(ext) || lower.contains(&format!("{}.", ext)))
}

pub(super) fn is_weak_save_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    weak_save_extensions()
        .iter()
        .any(|ext| lower.ends_with(ext))
}

pub(super) fn name_hints_save(name: &str) -> bool {
    let lower = name.to_lowercase();
    save_name_hints().iter().any(|h| lower.contains(h))
}

/// Si el nombre de la carpeta sugiere que contiene guardados (ej. "Saves", "SaveGames").
pub(super) fn folder_name_hints_save(folder_name: &str) -> bool {
    let lower = folder_name.to_lowercase().trim().to_string();
    save_folder_names().iter().any(|n| *n == lower)
}

pub(super) fn folder_contains_save_like_files(dir_path: &Path) -> bool {
    if !dir_path.exists() || !dir_path.is_dir() {
        return false;
    }
    let folder_name = dir_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let folder_hints = folder_name_hints_save(folder_name);

    let files = collect_files(dir_path);
    let mut weak_count = 0usize;
    for name in &files {
        if is_strong_save_file(name) {
            return true;
        }
        if is_weak_save_file(name) {
            if name_hints_save(name) {
                return true;
            }
            weak_count += 1;
        }
    }
    // Si el nombre de la carpeta sugiere guardados, umbral más bajo (1 en vez de 3).
    let threshold = if folder_hints { 1 } else { 3 };
    weak_count >= threshold
}

/// Carpetas que parecen IDs, hashes o UUIDs (Steam ID, profile ID, cache hash, etc.).
fn is_likely_id_or_hash(name: &str) -> bool {
    let s = name.trim();
    if s.is_empty() || s.len() > 128 {
        return false;
    }

    if s.chars().all(|c| c.is_ascii_digit()) && s.len() > 12 {
        return true;
    }

    // Hex puro (32+ caracteres): Hashes de caché largos
    if s.len() >= 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return true;
    }

    // UUID con guiones: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    if s.len() >= 36 && s.contains('-') {
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() == 5
            && parts
                .iter()
                .all(|p| p.chars().all(|c| c.is_ascii_hexdigit()))
        {
            return true;
        }
    }

    // Hash con prefijo: st_76561199073321731 (Steam ID en No Man's Sky)
    if s.starts_with("st_") && s.len() > 18 && s[3..].chars().all(|c| c.is_ascii_digit()) {
        return true;
    }

    false
}

pub(super) fn is_excluded_folder(name: &str) -> bool {
    let lower = name.to_lowercase().trim().to_string();

    if EXCLUDED_FOLDER_NAMES.contains(&lower) {
        return true;
    }

    if is_likely_id_or_hash(name) {
        return true;
    }

    excluded_partial_patterns()
        .iter()
        .any(|p| lower.contains(&p.to_lowercase()))
}

/// Profundidad máxima al buscar archivos recursivamente (ej. GameName/Saved/SaveGames).
const MAX_COLLECT_DEPTH: usize = 3;

fn collect_files_recursive(dir_path: &Path, depth: usize, names: &mut Vec<String>) {
    if depth > MAX_COLLECT_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir_path) else {
        return;
    };
    for e in entries.filter_map(|x| x.ok()) {
        if let Ok(meta) = e.metadata() {
            let name_os = e.file_name();
            let name = name_os.to_string_lossy();

            if name.starts_with('.') || is_excluded_folder(&name) {
                continue;
            }

            if meta.is_file() {
                names.push(name.into_owned());
            } else if meta.is_dir() {
                collect_files_recursive(&dir_path.join(name_os), depth + 1, names);
            }
        }
    }
}

pub(super) fn collect_files(dir_path: &Path) -> Vec<String> {
    let mut names = Vec::new();
    collect_files_recursive(dir_path, 0, &mut names);
    names
}
