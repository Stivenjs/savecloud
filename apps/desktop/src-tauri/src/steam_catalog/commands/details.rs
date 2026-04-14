//! Ficha enriquecida de una app del catálogo (caché + Store API).

use std::ops::Deref;

use tauri::State;

use crate::sqlite::AppDb;
use crate::steam_cache::SteamAppDetails;

use crate::steam_catalog::enrichment::fetch_catalog_app_details;

/// Ficha completa: prioriza caché RAM, luego JSON en SQLite, luego Store API; persiste en disco.
#[tauri::command]
pub async fn get_steam_catalog_app_details(
    db: State<'_, AppDb>,
    app_id: String,
) -> Result<SteamAppDetails, String> {
    let db = db.deref().clone();
    fetch_catalog_app_details(&db, app_id).await
}
