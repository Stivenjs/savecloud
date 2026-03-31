//! Comandos Tauri del módulo de fuentes.

use tauri::{AppHandle, Manager};

use crate::network::API_CLIENT;

use super::domain::{
    DownloadProtocol, ImportMode, SourceCatalogSummary, SourceDownloadJob, SourceItemsPage,
    SourceJobStatus, SourceMatchCandidate, SourceMatchResult,
};
use super::parser::parse_catalog;
use super::queue::{cancel_job, new_job_id, now_iso, spawn_job, SourcesState};
use super::store;

/// Lista catálogos de fuentes importados.
#[tauri::command]
pub async fn list_sources() -> Result<Vec<super::domain::SourceCatalog>, String> {
    store::load_sources()
}

/// Lista catálogo en modo resumen para evitar cargas pesadas en UI.
#[tauri::command]
pub async fn list_sources_summary() -> Result<Vec<SourceCatalogSummary>, String> {
    let sources = store::load_sources()?;
    Ok(sources
        .into_iter()
        .map(|s| SourceCatalogSummary {
            id: s.id,
            name: s.name,
            source_url: s.source_url,
            imported_at: s.imported_at,
            downloads_count: s.downloads.len(),
        })
        .collect())
}

/// Obtiene una página de items de un catálogo para evitar freezes.
#[tauri::command]
pub async fn list_source_items_page(
    source_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<SourceItemsPage, String> {
    let sources = store::load_sources()?;
    let source = sources
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;

    let safe_offset = offset.unwrap_or(0);
    let safe_limit = limit.unwrap_or(50).clamp(1, 200);
    let total = source.downloads.len();
    let items = source
        .downloads
        .into_iter()
        .skip(safe_offset)
        .take(safe_limit)
        .collect();

    Ok(SourceItemsPage {
        source_id: source.id,
        total,
        offset: safe_offset,
        limit: safe_limit,
        items,
    })
}

/// Elimina un catálogo por ID.
#[tauri::command]
pub async fn remove_source(source_id: String) -> Result<(), String> {
    store::remove_catalog(&source_id)
}

/// Importa fuente desde archivo JSON.
#[tauri::command]
pub async fn import_source_from_file(
    path: String,
    mode: ImportMode,
) -> Result<super::domain::SourceCatalog, String> {
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("No se pudo leer JSON: {e}"))?;
    let catalog = parse_catalog(&raw, Some(format!("file://{path}")))?;
    store::upsert_catalog(catalog, mode)
}

/// Importa fuente desde URL JSON.
#[tauri::command]
pub async fn import_source_from_url(
    url: String,
    mode: ImportMode,
) -> Result<super::domain::SourceCatalog, String> {
    let response = API_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la fuente: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("La URL devolvió estado HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta: {e}"))?;
    let lower = raw.to_ascii_lowercase();
    let looks_like_cloudflare_block = content_type.contains("text/html")
        || lower.contains("cloudflare")
        || lower.contains("cf-chl")
        || lower.contains("captcha")
        || lower.contains("attention required");
    if looks_like_cloudflare_block {
        return Err(
            "La URL está protegida por Cloudflare/CAPTCHA y no permite importación automática. Descarga el JSON manualmente e impórtalo por archivo."
                .to_string(),
        );
    }
    let catalog = parse_catalog(&raw, Some(url))?;
    store::upsert_catalog(catalog, mode)
}

fn normalize_title(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = false;
    for ch in input.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn similarity_score(left: &str, right: &str) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right {
        return 1.0;
    }
    if left.contains(right) || right.contains(left) {
        return 0.96;
    }
    let left_tokens: std::collections::BTreeSet<&str> = left.split_whitespace().collect();
    let right_tokens: std::collections::BTreeSet<&str> = right.split_whitespace().collect();
    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }
    let intersection = left_tokens.intersection(&right_tokens).count() as f32;
    let union = left_tokens.union(&right_tokens).count() as f32;
    intersection / union
}

#[derive(Debug, Clone)]
struct IndexedSourceItem {
    source_id: String,
    source_name: String,
    item_id: String,
    item_title: String,
    normalized_title: String,
    protocols: Vec<DownloadProtocol>,
}

fn build_match_index() -> Result<Vec<IndexedSourceItem>, String> {
    let mut out: Vec<IndexedSourceItem> = vec![];
    for source in store::load_sources()? {
        for item in source.downloads {
            let mut protocols: Vec<DownloadProtocol> = vec![];
            for uri in item.uris {
                if !protocols.contains(&uri.protocol) {
                    protocols.push(uri.protocol);
                }
            }
            out.push(IndexedSourceItem {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                item_id: item.id,
                item_title: item.title.clone(),
                normalized_title: normalize_title(&item.title),
                protocols,
            });
        }
    }
    Ok(out)
}

fn find_matches_from_index(
    game_name: &str,
    normalized_game: &str,
    threshold: f32,
    index: &[IndexedSourceItem],
) -> SourceMatchResult {
    let mut matches: Vec<SourceMatchCandidate> = vec![];
    for item in index {
        let score = similarity_score(normalized_game, &item.normalized_title);
        if score >= threshold {
            matches.push(SourceMatchCandidate {
                source_id: item.source_id.clone(),
                source_name: item.source_name.clone(),
                item_id: item.item_id.clone(),
                item_title: item.item_title.clone(),
                score,
                protocols: item.protocols.clone(),
            });
        }
    }
    matches.sort_by(|a, b| b.score.total_cmp(&a.score));
    if matches.len() > 5 {
        matches.truncate(5);
    }
    let best = matches.first().cloned();
    SourceMatchResult {
        game_name: game_name.to_string(),
        best,
        candidates: matches,
    }
}

/// Busca match para un juego contra las fuentes importadas (normalizado + fuzzy).
#[tauri::command]
pub async fn sources_find_match_for_game(
    game_name: String,
    threshold: Option<f32>,
) -> Result<SourceMatchResult, String> {
    let index = build_match_index()?;
    let normalized_game = normalize_title(&game_name);
    Ok(find_matches_from_index(
        &game_name,
        &normalized_game,
        threshold.unwrap_or(0.58),
        &index,
    ))
}

/// Busca matches para una lista de juegos visibles en catálogo.
#[tauri::command]
pub async fn sources_find_matches_batch(
    game_names: Vec<String>,
    threshold: Option<f32>,
) -> Result<Vec<SourceMatchResult>, String> {
    let index = build_match_index()?;
    let mut out = Vec::with_capacity(game_names.len());
    let score_threshold = threshold.unwrap_or(0.58);
    for name in game_names {
        let normalized_game = normalize_title(&name);
        out.push(find_matches_from_index(
            &name,
            &normalized_game,
            score_threshold,
            &index,
        ));
    }
    Ok(out)
}

/// Lista jobs del motor de fuentes.
#[tauri::command]
pub async fn list_source_download_jobs(
    state: tauri::State<'_, SourcesState>,
) -> Result<Vec<SourceDownloadJob>, String> {
    Ok(state.list_jobs())
}

/// Encola e inicia un job de descarga.
#[tauri::command]
pub async fn start_source_download(
    source_id: String,
    item_id: String,
    destination_dir: String,
    preferred_protocol: Option<DownloadProtocol>,
    app: AppHandle,
    state: tauri::State<'_, SourcesState>,
) -> Result<String, String> {
    let sources = store::load_sources()?;
    let source = sources
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;
    let item = source
        .downloads
        .iter()
        .find(|s| s.id == item_id)
        .ok_or_else(|| format!("Item no encontrado: {item_id}"))?;

    let selected = if let Some(pref) = preferred_protocol {
        item.uris
            .iter()
            .find(|u| u.protocol == pref)
            .cloned()
            .or_else(|| item.uris.first().cloned())
    } else {
        item.uris
            .iter()
            .find(|u| {
                matches!(
                    u.protocol,
                    DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
                )
            })
            .cloned()
            .or_else(|| {
                item.uris
                    .iter()
                    .find(|u| u.protocol == DownloadProtocol::Http)
                    .cloned()
            })
            .or_else(|| item.uris.first().cloned())
    }
    .ok_or_else(|| "No hay URIs válidas para descargar".to_string())?;

    let job_id = new_job_id();
    let now = now_iso();
    let job = SourceDownloadJob {
        job_id: job_id.clone(),
        source_id: source_id.clone(),
        item_id: item_id.clone(),
        title: item.title.clone(),
        destination_dir,
        selected_uri: selected.uri,
        protocol: selected.protocol,
        status: SourceJobStatus::Queued,
        loaded: 0,
        total: 0,
        error: None,
        external_id: None,
        created_at: now.clone(),
        updated_at: now,
    };

    state.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    spawn_job(app, job_id.clone());
    Ok(job_id)
}

/// Solicita cancelación de un job.
#[tauri::command]
pub async fn cancel_source_download(
    job_id: String,
    state: tauri::State<'_, SourcesState>,
) -> Result<(), String> {
    cancel_job(&state, &job_id);
    Ok(())
}

/// Pausa un job torrent en ejecución.
#[tauri::command]
pub async fn pause_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;
    let Some(info_hash) = job.external_id.clone() else {
        return Err("El job no tiene info_hash activo".to_string());
    };
    let torrent_state = app.state::<crate::torrent::state::TorrentState>();
    let session = {
        let engine = torrent_state.engine.lock().await;
        engine.session()
    };
    crate::torrent::engine::pause_via_session(&session, &info_hash)
        .await
        .map_err(|e| e.to_string())?;
    job.status = SourceJobStatus::Paused;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    Ok(())
}

/// Reanuda un job torrent pausado.
#[tauri::command]
pub async fn resume_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;
    let Some(info_hash) = job.external_id.clone() else {
        return Err("El job no tiene info_hash activo".to_string());
    };
    let torrent_state = app.state::<crate::torrent::state::TorrentState>();
    let session = {
        let engine = torrent_state.engine.lock().await;
        engine.session()
    };
    crate::torrent::engine::resume_via_session(&session, &info_hash)
        .await
        .map_err(|e| e.to_string())?;
    job.status = SourceJobStatus::Running;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;
    super::events::emit_progress(&app, &job);
    Ok(())
}
