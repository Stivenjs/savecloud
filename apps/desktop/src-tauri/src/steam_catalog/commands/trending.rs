//! Sincroniza el ranking de tendencia desde la API pública de la tienda (sin clave Steam).

use std::ops::Deref;

use tauri::State;

use crate::sqlite::AppDb;
use crate::steam_catalog::trending::sync_store_trending;

/// Descarga listas destacadas de la tienda (más vendidos, ofertas, novedades) y actualiza el orden local.
#[tauri::command]
pub async fn sync_steam_store_trending(db: State<'_, AppDb>) -> Result<usize, String> {
    sync_store_trending(db.deref()).await
}
