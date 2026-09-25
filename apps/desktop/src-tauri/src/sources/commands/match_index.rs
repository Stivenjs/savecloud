use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;
use rayon::prelude::*;

use super::super::domain::DownloadProtocol;
use super::super::matcher::{
    extract_title_aliases, find_best_per_source, fnv1a, normalize_title, tokenize_sorted_filtered,
    IndexEntry, MatchConfig, MatchIndex, SourceBestMatch,
};
use super::super::store;

type IndexCacheStore = Option<Arc<MatchIndex>>;

static INDEX_CACHE: Lazy<Arc<RwLock<IndexCacheStore>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

static MATCH_CONFIG: Lazy<Arc<RwLock<Option<MatchConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

static MATCH_CACHE: Lazy<Arc<RwLock<HashMap<String, Vec<SourceBestMatch>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::with_capacity(512))));

/// Carga stopwords embebidas y devuelve sus hashes FNV.
pub fn load_stopwords() -> Result<Vec<u64>, String> {
    let raw = include_str!("../stopwords.json");

    let words: Vec<String> =
        serde_json::from_str(raw).map_err(|e| format!("stopwords.json inválido: {e}"))?;

    let mut hashes: Vec<u64> = words.iter().map(|w| fnv1a(&normalize_title(w))).collect();
    hashes.sort_unstable();
    hashes.dedup();

    Ok(hashes)
}

/// Inicializa la configuración global del motor de emparejamiento.
pub fn init_match_config(threshold: f32) -> Result<(), String> {
    let stopwords = load_stopwords()?;
    let config = MatchConfig {
        threshold,
        stopwords,
    };
    if let Ok(mut guard) = MATCH_CONFIG.write() {
        *guard = Some(config);
    }
    Ok(())
}

fn get_match_config(threshold_override: Option<f32>) -> MatchConfig {
    let base = MATCH_CONFIG
        .read()
        .ok()
        .and_then(|g| g.as_ref().cloned())
        .unwrap_or_else(|| MatchConfig {
            threshold: 0.60,
            stopwords: vec![],
        });

    match threshold_override {
        Some(t) => MatchConfig {
            threshold: t,
            ..base
        },
        None => base,
    }
}

/// Invalida el índice en memoria tras cambios en el catálogo local.
pub(crate) fn invalidate_index() {
    if let Ok(mut guard) = INDEX_CACHE.write() {
        *guard = None;
    }
    if let Ok(mut guard) = MATCH_CACHE.write() {
        guard.clear();
    }
}

fn get_or_build_index() -> Result<Arc<MatchIndex>, String> {
    {
        let guard = INDEX_CACHE
            .read()
            .map_err(|_| "Index cache read lock poisoned".to_string())?;
        if let Some(ref idx) = *guard {
            if !idx.is_empty() {
                return Ok(Arc::clone(idx));
            }
        }
    }

    let new_index = Arc::new(build_match_index()?);

    {
        let mut guard = INDEX_CACHE
            .write()
            .map_err(|_| "Index cache write lock poisoned".to_string())?;
        *guard = Some(Arc::clone(&new_index));
        Ok(Arc::clone(guard.as_ref().unwrap()))
    }
}

/// Pre-carga el índice de coincidencia de fuentes en memoria de manera asíncrona para acelerar la primera request.
pub fn preload_index_background() {
    tauri::async_runtime::spawn_blocking(|| {
        log::info!("[MatchIndex] Preloading match index in background...");
        match get_or_build_index() {
            Ok(_) => log::info!("[MatchIndex] Match index preloaded successfully on startup"),
            Err(e) => log::warn!("[MatchIndex] Failed to preload match index: {}", e),
        }
    });
}

fn build_match_index() -> Result<MatchIndex, String> {
    let config = get_match_config(None);
    let mut out: Vec<IndexEntry> = vec![];

    for source in store::load_sources()? {
        for item in source.downloads {
            let mut protocols: Vec<DownloadProtocol> = vec![];
            for uri in &item.uris {
                if !protocols.contains(&uri.protocol) {
                    protocols.push(uri.protocol.clone());
                }
            }
            let clean_aliases = extract_title_aliases(&item.title);
            let normalized = normalize_title(&item.title);
            let token_hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
            out.push(IndexEntry {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                item_id: item.id,
                item_title: item.title.clone(),
                normalized_title: normalized,
                clean_aliases,
                token_hashes,
                protocols,
                file_size: item.file_size.clone(),
                uris: item.uris,
            });
        }
    }
    Ok(MatchIndex::build(out))
}

/// Busca la mejor coincidencia por catálogo para un título.
#[tauri::command]
pub async fn sources_find_match_for_game(
    game_name: String,
    threshold: Option<f32>,
) -> Result<Vec<SourceBestMatch>, String> {
    if game_name.trim().is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(guard) = MATCH_CACHE.read() {
        if let Some(cached) = guard.get(&game_name) {
            return Ok(cached.clone());
        }
    }

    let index = get_or_build_index()?;
    let config = get_match_config(threshold);
    let normalized = normalize_title(&game_name);
    let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);

    let matches = find_best_per_source(&game_name, &normalized, &hashes, &config, &index);

    if let Ok(mut guard) = MATCH_CACHE.write() {
        guard.insert(game_name, matches.clone());
    }

    Ok(matches)
}

/// Búsqueda por lotes reutilizando el mismo índice en memoria con caché rápido.
#[tauri::command]
pub async fn sources_find_matches_batch(
    game_names: Vec<String>,
    threshold: Option<f32>,
) -> Result<Vec<(String, Vec<SourceBestMatch>)>, String> {
    if game_names.is_empty() {
        return Ok(Vec::new());
    }

    let index = get_or_build_index()?;
    let config = get_match_config(threshold);

    let mut results: Vec<(String, Vec<SourceBestMatch>)> = Vec::with_capacity(game_names.len());
    let mut missing_names: Vec<String> = Vec::new();

    {
        if let Ok(guard) = MATCH_CACHE.read() {
            for name in &game_names {
                if let Some(cached) = guard.get(name) {
                    results.push((name.clone(), cached.clone()));
                } else {
                    missing_names.push(name.clone());
                }
            }
        }
    }

    if missing_names.is_empty() {
        return Ok(results);
    }

    let computed: Vec<(String, Vec<SourceBestMatch>)> = if missing_names.len() <= 4 {
        missing_names
            .into_iter()
            .map(|name| {
                let normalized = normalize_title(&name);
                let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
                let matches = find_best_per_source(&name, &normalized, &hashes, &config, &index);
                (name, matches)
            })
            .collect()
    } else {
        missing_names
            .into_par_iter()
            .map(|name| {
                let normalized = normalize_title(&name);
                let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
                let matches = find_best_per_source(&name, &normalized, &hashes, &config, &index);
                (name, matches)
            })
            .collect()
    };

    if let Ok(mut guard) = MATCH_CACHE.write() {
        for (name, matches) in &computed {
            guard.insert(name.clone(), matches.clone());
        }
    }

    results.extend(computed);
    Ok(results)
}
