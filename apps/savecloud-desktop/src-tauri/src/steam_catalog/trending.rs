//! Tendencia aproximada desde la API pública de la tienda (`/api/featuredcategories`):
//! orden por bloques de la portada (más vendidos → ofertas → novedades → próximamente, …) y luego
//! cualquier otro bloque con `items` en la misma forma (solo `type == 0` apps, sin subs/bundles).
//!
//! La misma tabla puede rellenarse con la lista de prioridad en la nube (`priority_appids.jsonl`),
//! reflejando el orden que exportó el host (ver `sync_apply_cloud_priority_trending` en sync/steam_seed).

use std::collections::HashSet;

use rusqlite::Connection;
use serde_json::Value;

use crate::network::API_CLIENT;
use crate::sqlite::AppDb;

const FEATURED_URL: &str = "https://store.steampowered.com/api/featuredcategories?cc=ES&l=spanish";

/// Prioridad de la “home” de la tienda: primero estos bloques (mejor rango al deduplicar).
const PRIMARY_CATEGORY_KEYS: &[&str] = &["top_sellers", "specials", "new_releases", "coming_soon"];

fn append_games_from_items_array(items: &[Value], seen: &mut HashSet<u32>, out: &mut Vec<u32>) {
    for item in items {
        if item.get("type").and_then(|t| t.as_u64()) != Some(0) {
            continue;
        }
        let Some(id) = item
            .get("id")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
        else {
            continue;
        };
        if seen.insert(id) {
            out.push(id);
        }
    }
}

fn append_category_if_present(
    root: &Value,
    key: &str,
    seen: &mut HashSet<u32>,
    out: &mut Vec<u32>,
) {
    let Some(items) = root
        .get(key)
        .and_then(|s| s.get("items"))
        .and_then(|i| i.as_array())
    else {
        return;
    };
    append_games_from_items_array(items, seen, out);
}

/// Parsea bloques `featuredcategories`; deduplica por primera aparición (mejor rango).
/// Incluye todos los `items` que envía Steam por bloque y, al final, otros bloques con la misma forma.
fn parse_trending_app_ids(root: &Value) -> Vec<u32> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for &key in PRIMARY_CATEGORY_KEYS {
        append_category_if_present(root, key, &mut seen, &mut out);
    }

    let Some(map) = root.as_object() else {
        return out;
    };

    let mut extra: Vec<&str> = map
        .keys()
        .map(|s| s.as_str())
        .filter(|k| !PRIMARY_CATEGORY_KEYS.contains(k))
        .collect();
    extra.sort_unstable();

    for key in extra {
        append_category_if_present(root, key, &mut seen, &mut out);
    }

    out
}

/// Reemplaza por completo `steam_catalog_trending` con los appids dados (orden = rank ascendente).
pub fn replace_trending_app_ids(conn: &Connection, ranked: &[u32]) -> Result<(), rusqlite::Error> {
    conn.execute_batch("BEGIN IMMEDIATE; DELETE FROM steam_catalog_trending;")?;
    for (rank, app_id) in ranked.iter().enumerate() {
        conn.execute(
            "INSERT INTO steam_catalog_trending (app_id, rank, updated_at) VALUES (?1, ?2, unixepoch())",
            rusqlite::params![*app_id as i64, rank as i64],
        )?;
    }
    conn.execute_batch("COMMIT;")?;
    Ok(())
}

/// Descarga listas de la tienda y reemplaza `steam_catalog_trending`. Devuelve cuántas entradas se guardaron.
pub async fn sync_store_trending(db: &AppDb) -> Result<usize, String> {
    let res = API_CLIENT
        .get(FEATURED_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "HTTP {} al descargar tendencias de la tienda",
            res.status()
        ));
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let ranked = parse_trending_app_ids(&body);
    let n = ranked.len();
    let db = db.clone();
    tokio::task::spawn_blocking(move || {
        db.with_conn(|c| {
            replace_trending_app_ids(c, &ranked)?;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    Ok(n)
}
