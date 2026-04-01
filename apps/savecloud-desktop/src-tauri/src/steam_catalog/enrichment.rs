//! Enriquecimiento: `appdetails` de la Store + persistencia en `details_json`.

use rusqlite::Connection;

use crate::sqlite::error::SqliteError;
use crate::sqlite::AppDb;
use crate::steam::appdetails::fetch_steam_app_details_from_store;
use crate::steam::appdetails::steam_app_details_from_store_data;
use crate::steam_cache::{normalize_steam_app_id, steam_api_cache, SteamAppDetails};

fn catalog_contains_app(conn: &Connection, app_id: u32) -> Result<bool, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM steam_catalog_apps WHERE app_id = ?1",
        [app_id],
        |row| row.get(0),
    )?;
    Ok(n > 0)
}

fn load_details_json(conn: &Connection, app_id: u32) -> Result<Option<String>, rusqlite::Error> {
    match conn.query_row(
        "SELECT details_json FROM steam_catalog_apps WHERE app_id = ?1",
        [app_id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

fn save_details_json(conn: &Connection, app_id: u32, json: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE steam_catalog_apps SET details_json = ?1, enriched_at = unixepoch() WHERE app_id = ?2",
        rusqlite::params![json, app_id],
    )?;
    Ok(())
}

/// Ficha completa: caché RAM → JSON en SQLite → Store API si hace falta.
///
/// Solo aplica a apps presentes en `steam_catalog_apps`; si no, devuelve error explícito.
pub async fn fetch_catalog_app_details(
    db: &AppDb,
    app_id: String,
) -> Result<SteamAppDetails, String> {
    let Some(sid) = normalize_steam_app_id(&app_id) else {
        return Err("App ID inválido".to_string());
    };
    let pid = sid
        .parse::<u32>()
        .map_err(|_| "App ID inválido".to_string())?;

    if let Some(c) = steam_api_cache().get_details(&sid) {
        return Ok(c);
    }

    let db1 = db.clone();
    let json_opt =
        tokio::task::spawn_blocking(move || db1.with_conn(|c| load_details_json(c, pid)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: SqliteError| e.to_string())?;

    if let Some(ref j) = json_opt {
        if let Ok(details) = serde_json::from_str::<SteamAppDetails>(j) {
            steam_api_cache().insert_details(sid.clone(), details.clone());
            return Ok(details);
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(j) {
            if v.as_object().is_some() {
                let details = steam_app_details_from_store_data(&v);
                steam_api_cache().insert_details(sid.clone(), details.clone());
                return Ok(details);
            }
        }
    }

    let db2 = db.clone();
    let exists =
        tokio::task::spawn_blocking(move || db2.with_conn(|c| catalog_contains_app(c, pid)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: SqliteError| e.to_string())?;

    if !exists {
        return Err(
            "Este juego no está en el catálogo local. Sincroniza el catálogo primero.".to_string(),
        );
    }

    let details = fetch_steam_app_details_from_store(&sid).await?;

    let json = serde_json::to_string(&details).map_err(|e| e.to_string())?;
    let db3 = db.clone();
    tokio::task::spawn_blocking(move || db3.with_conn(|c| save_details_json(c, pid, &json)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e: SqliteError| e.to_string())?;

    steam_api_cache().insert_details(sid, details.clone());
    Ok(details)
}
