//! Índice en memoria y comandos de búsqueda por título.

use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;
use rayon::prelude::*;

use super::super::domain::DownloadProtocol;
use super::super::matcher::{
    find_best_per_source, fnv1a, normalize_title, tokenize_sorted_filtered, IndexEntry,
    MatchConfig, SourceBestMatch,
};
use super::super::store;

type IndexedSourceItem = IndexEntry;
type IndexCacheStore = Option<Arc<Vec<IndexedSourceItem>>>;

static INDEX_CACHE: Lazy<Arc<RwLock<IndexCacheStore>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

static MATCH_CONFIG: Lazy<Arc<RwLock<Option<MatchConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

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
            threshold: 0.58,
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
}

fn get_or_build_index() -> Result<Arc<Vec<IndexedSourceItem>>, String> {
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

fn build_match_index() -> Result<Vec<IndexedSourceItem>, String> {
    let config = get_match_config(None);
    let mut out: Vec<IndexedSourceItem> = vec![];

    for source in store::load_sources()? {
        for item in source.downloads {
            let mut protocols: Vec<DownloadProtocol> = vec![];
            for uri in &item.uris {
                if !protocols.contains(&uri.protocol) {
                    protocols.push(uri.protocol.clone());
                }
            }
            let normalized = normalize_title(&item.title);
            let token_hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
            out.push(IndexedSourceItem {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                item_id: item.id,
                item_title: item.title.clone(),
                normalized_title: normalized,
                token_hashes,
                protocols,
                file_size: item.file_size.clone(),
                uris: item.uris,
            });
        }
    }
    Ok(out)
}

/// Busca la mejor coincidencia por catálogo para un título.
#[tauri::command]
pub async fn sources_find_match_for_game(
    game_name: String,
    threshold: Option<f32>,
) -> Result<Vec<SourceBestMatch>, String> {
    let index = get_or_build_index()?;
    let config = get_match_config(threshold);
    let normalized = normalize_title(&game_name);
    let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);

    Ok(find_best_per_source(
        &game_name,
        &normalized,
        &hashes,
        &config,
        &index,
    ))
}

/// Búsqueda por lotes reutilizando el mismo índice en memoria.
#[tauri::command]
pub async fn sources_find_matches_batch(
    game_names: Vec<String>,
    threshold: Option<f32>,
) -> Result<Vec<(String, Vec<SourceBestMatch>)>, String> {
    let index = get_or_build_index()?;
    let config = get_match_config(threshold);

    let results: Vec<(String, Vec<SourceBestMatch>)> = game_names
        .par_iter()
        .map(|name| {
            let normalized = normalize_title(name);
            let hashes = tokenize_sorted_filtered(&normalized, &config.stopwords);
            let matches = find_best_per_source(name, &normalized, &hashes, &config, &index);
            (name.clone(), matches)
        })
        .collect();

    Ok(results)
}
