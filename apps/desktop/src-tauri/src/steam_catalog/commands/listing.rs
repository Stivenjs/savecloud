//! Consultas locales al catálogo (búsqueda, paginación y facetas).

use std::ops::Deref;
use std::sync::RwLock;

use once_cell::sync::Lazy;
use tauri::State;

use crate::sqlite::AppDb;
use crate::steam_cache::normalize_steam_app_id;

use crate::steam_catalog::query as catalog_query;
use crate::steam_catalog::types::{CatalogFilterFacets, CatalogListItem, CatalogPage};

fn sanitize_filter_list(v: Option<Vec<String>>) -> Vec<String> {
    v.unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Búsqueda por nombre: tokens normalizados (AND) y orden por relevancia; ver `search_catalog_filtered`.
#[tauri::command]
pub async fn search_steam_catalog(
    db: State<'_, AppDb>,
    query: String,
    limit: Option<u32>,
    genres: Option<Vec<String>>,
    tags: Option<Vec<String>>,
) -> Result<Vec<CatalogListItem>, String> {
    let q = query.trim().to_string();
    let limit = limit.unwrap_or(50).min(500);
    let genres = sanitize_filter_list(genres);
    let tags = sanitize_filter_list(tags);
    let db = db.deref().clone();
    tokio::task::spawn_blocking(move || {
        db.with_conn(|c| catalog_query::search_catalog_filtered(c, &q, limit, &genres, &tags))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Listado paginado estable por `app_id` + total de filas (total respecto a los mismos filtros).
///
/// Si `cached_total` es `Some(n)`, se omite la query de COUNT (costosa con filtros)
/// y se reutiliza el total proporcionado por el frontend. El frontend pasa el total
/// obtenido en la primera página al navegar al resto de páginas con los mismos filtros.
#[tauri::command]
pub async fn list_steam_catalog_page(
    db: State<'_, AppDb>,
    offset: Option<u32>,
    limit: Option<u32>,
    genres: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    cached_total: Option<u64>,
) -> Result<CatalogPage, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(50).min(500);
    let genres = sanitize_filter_list(genres);
    let tags = sanitize_filter_list(tags);
    let db = db.deref().clone();
    tokio::task::spawn_blocking(move || {
        db.with_conn(|c| {
            catalog_query::catalog_page_filtered(c, offset, limit, &genres, &tags, cached_total)
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

static FACETS_CACHE: Lazy<RwLock<Option<CatalogFilterFacets>>> =
    Lazy::new(|| RwLock::new(None));

/// Pre-carga las facetas de filtro en memoria en segundo plano al iniciar la aplicación.
pub fn preload_facets_background(db: AppDb) {
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("[FacetsPreload] Preloading filter facets in background...");
        match db.with_conn(catalog_query::filter_facets) {
            Ok(facets) => {
                if let Ok(mut guard) = FACETS_CACHE.write() {
                    *guard = Some(facets);
                }
                log::info!("[FacetsPreload] Filter facets preloaded successfully");
            }
            Err(e) => {
                log::warn!("[FacetsPreload] Failed to preload filter facets: {}", e);
            }
        }
    });
}

/// Invalida la caché de facetas en memoria.
pub fn invalidate_facets_cache() {
    if let Ok(mut guard) = FACETS_CACHE.write() {
        *guard = None;
        log::info!("[FacetsPreload] Filter facets cache invalidated");
    }
}

/// Géneros y etiquetas (categorías) con recuento, solo apps con `details_json`.
#[tauri::command]
pub async fn get_steam_catalog_filter_facets(
    db: State<'_, AppDb>,
) -> Result<CatalogFilterFacets, String> {
    {
        if let Ok(guard) = FACETS_CACHE.read() {
            if let Some(ref cached) = *guard {
                return Ok(cached.clone());
            }
        }
    }

    let db = db.deref().clone();
    let facets = tokio::task::spawn_blocking(move || db.with_conn(catalog_query::filter_facets))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = FACETS_CACHE.write() {
        *guard = Some(facets.clone());
    }

    Ok(facets)
}

/// Top de tendencias para el hero de la primera vista del catálogo.
#[tauri::command]
pub async fn list_steam_catalog_trending_hero(
    db: State<'_, AppDb>,
    limit: Option<u32>,
) -> Result<Vec<CatalogListItem>, String> {
    let cap = limit.unwrap_or(10).max(1).min(20);
    let db = db.deref().clone();
    tokio::task::spawn_blocking(move || {
        db.with_conn(|c| catalog_query::list_catalog_trending_hero(c, cap))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Nombre del catálogo local para un App ID (el mismo que usa el grid y el matcher de fuentes).
#[tauri::command]
pub async fn get_steam_catalog_listing_name(
    db: State<'_, AppDb>,
    app_id: String,
) -> Result<Option<String>, String> {
    let Some(sid) = normalize_steam_app_id(&app_id) else {
        return Ok(None);
    };
    let pid = sid
        .parse::<u32>()
        .map_err(|_| "App ID inválido".to_string())?;
    let db = db.deref().clone();
    tokio::task::spawn_blocking(move || {
        db.with_conn(|c| catalog_query::get_catalog_listing_name(c, pid))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
