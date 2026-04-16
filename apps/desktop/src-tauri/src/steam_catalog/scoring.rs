//! Motor de scoring para ranking de aplicaciones de Steam.
//!
//! # Características
//!
//! - Scoring determinístico y tolerante a datos incompletos
//! - Paralelización con `rayon` para procesamiento masivo
//! - Persistencia eficiente en SQLite
//! - Sistema incremental (evita recomputar todo)
//! - Índice optimizado para queries por ranking
//!
//! # Estrategia
//!
//! El score se compone de:
//! - Comunidad (log scale)
//! - Crítica (Metacritic)
//! - Estudio VIP
//! - Calidad técnica
//! - Media
//! - Recencia
//!
//! # Performance
//!
//! - CPU-bound → paralelizado
//! - DB-bound → batch + prepared statements
//! - Cache global para VIP studios

use rusqlite::Connection;
use std::sync::OnceLock;

use rayon::prelude::*;

pub const MAX_SCORE: i64 = 1_000_000;

const WEIGHT_COMMUNITY: i64 = 450_000;
const WEIGHT_CRITICAL: i64 = 200_000;
const WEIGHT_VIP_STUDIO: i64 = 250_000;
const WEIGHT_QUALITY: i64 = 100_000;
const WEIGHT_MEDIA: i64 = 50_000;
const WEIGHT_RECENCY: i64 = 50_000;

static VIP_STUDIOS: OnceLock<Vec<String>> = OnceLock::new();

fn get_vip_studios() -> &'static [String] {
    VIP_STUDIOS.get_or_init(|| {
        let json = include_str!("vip_studios.json");
        serde_json::from_str(json).expect("vip_studios.json inválido")
    })
}

fn is_vip_studio<'a, I>(mut names: I) -> bool
where
    I: Iterator<Item = &'a str>,
{
    let vips = get_vip_studios();

    names.any(|name| {
        let lower = name.to_ascii_lowercase();
        vips.iter().any(|vip| lower.contains(vip))
    })
}

fn community_score(data: &serde_json::Value) -> i64 {
    let total = data["recommendations"]["total"].as_f64().unwrap_or(0.0);

    if total <= 0.0 {
        return 0;
    }

    let log_val = total.log10().min(5.5);
    ((log_val / 5.5) * WEIGHT_COMMUNITY as f64) as i64
}

fn metacritic_score(data: &serde_json::Value) -> i64 {
    let score = data["metacritic"]["score"].as_i64().unwrap_or(0);

    if score > 0 {
        (score * 2000).min(WEIGHT_CRITICAL)
    } else {
        0
    }
}

fn vip_studio_score(data: &serde_json::Value) -> i64 {
    let devs = data["developers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str());

    let pubs = data["publishers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str());

    if is_vip_studio(devs) || is_vip_studio(pubs) {
        WEIGHT_VIP_STUDIO
    } else {
        0
    }
}

fn quality_score(data: &serde_json::Value) -> i64 {
    let mut score = 0;

    let langs = data["supported_languages"].as_str().unwrap_or("");
    let count = langs.split(',').filter(|s| !s.is_empty()).count();

    if count > 6 {
        score += 40_000;
    } else if count > 1 {
        score += 20_000;
    }

    if data["mac_requirements"].is_object() {
        score += 20_000;
    }
    if data["linux_requirements"].is_object() {
        score += 20_000;
    }

    score.min(WEIGHT_QUALITY)
}

fn media_score(data: &serde_json::Value) -> i64 {
    let screenshots = data["screenshots"].as_array().map(|a| a.len()).unwrap_or(0);

    let has_video = data["movies"]
        .as_array()
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    let video = if has_video { 30_000 } else { 0 };
    let shots = ((screenshots.min(10) as i64) * 2_000).min(20_000);

    (video + shots).min(WEIGHT_MEDIA)
}

fn recency_score(data: &serde_json::Value, current_year: i32) -> i64 {
    let year = data["release_date"]["date"]
        .as_str()
        .and_then(|s| s.split_whitespace().last())
        .and_then(|y| y.parse::<i32>().ok())
        .unwrap_or(current_year);

    let age = (current_year - year).max(0) as i64;
    (WEIGHT_RECENCY - age * 5_000).max(0)
}

pub fn compute_rank_score(details_json: &str) -> i64 {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(details_json) else {
        return 0;
    };

    let data = root.get("data").unwrap_or(&root);
    let year = current_year();

    let score = community_score(data)
        + metacritic_score(data)
        + vip_studio_score(data)
        + quality_score(data)
        + media_score(data)
        + recency_score(data, year);

    score.min(MAX_SCORE)
}

pub fn compute_rank_score_from_value(root: &serde_json::Value) -> i64 {
    let data = root.get("data").unwrap_or(root);
    let year = current_year();

    let score = community_score(data)
        + metacritic_score(data)
        + vip_studio_score(data)
        + quality_score(data)
        + media_score(data)
        + recency_score(data, year);

    score.min(MAX_SCORE)
}

fn current_year() -> i32 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    1970 + (secs as f64 / (365.2425 * 86400.0)) as i32
}

/// Crea índice para acelerar queries por ranking
///
/// Ejecutar una vez al iniciar la app
pub fn backfill_rank_scores(conn: &Connection) -> Result<u32, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT app_id, details_json FROM steam_catalog_apps WHERE details_json IS NOT NULL",
    )?;

    let mut rows_iter = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut total_computed = 0;

    // Procesamos en lotes de 5,000 para no saturar la RAM con strings gigantes de JSON.
    loop {
        let batch: Vec<(i64, String)> = rows_iter.by_ref().take(5000).collect::<Result<_, _>>()?;

        if batch.is_empty() {
            break;
        }

        let computed: Vec<(i64, i64)> = batch
            .par_iter()
            .map(|(app_id, json)| (*app_id, compute_rank_score(json)))
            .collect();

        // Usamos una transacción por lote para persistencia eficiente.
        let tx = conn.unchecked_transaction()?;
        {
            let mut upd = tx.prepare_cached(
                "UPDATE steam_catalog_apps SET catalog_rank_score = ?1 WHERE app_id = ?2",
            )?;

            for (app_id, score) in &computed {
                upd.execute(rusqlite::params![score, app_id])?;
            }
        }
        tx.commit()?;
        total_computed += computed.len() as u32;
    }

    Ok(total_computed)
}

/// Incremental: solo recalcula los que NO tienen score
pub fn update_missing_scores(conn: &Connection) -> Result<u32, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT app_id, details_json
         FROM steam_catalog_apps
         WHERE catalog_rank_score IS NULL
         AND details_json IS NOT NULL",
    )?;

    let mut rows_iter = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut total_computed = 0;

    loop {
        let batch: Vec<(i64, String)> = rows_iter.by_ref().take(5000).collect::<Result<_, _>>()?;

        if batch.is_empty() {
            break;
        }

        let computed: Vec<(i64, i64)> = batch
            .par_iter()
            .map(|(id, json)| (*id, compute_rank_score(json)))
            .collect();

        let tx = conn.unchecked_transaction()?;
        {
            let mut upd = tx.prepare_cached(
                "UPDATE steam_catalog_apps SET catalog_rank_score = ?1 WHERE app_id = ?2",
            )?;

            for (id, score) in &computed {
                upd.execute(rusqlite::params![score, id])?;
            }
        }
        tx.commit()?;
        total_computed += computed.len() as u32;
    }

    Ok(total_computed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_data(
        app_id: i64,
        year: &str,
        recs: i64,
        meta: i64,
        langs: &str,
        devs: Vec<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "data": {
                "steam_appid": app_id,
                "release_date": { "date": year },
                "recommendations": { "total": recs },
                "metacritic": { "score": meta },
                "supported_languages": langs,
                "developers": devs,
                "publishers": ["Random Pub"],
                "mac_requirements": {},
                "categories": [],
                "screenshots": [{}],
                "movies": []
            }
        })
    }

    #[test]
    fn vip_studio_gets_massive_boost() {
        let generic = serde_json::to_string(&make_data(
            500000,
            "2024",
            100,
            0,
            "English",
            vec!["Unknown Studio"],
        ))
        .unwrap();

        let valve =
            serde_json::to_string(&make_data(10, "2000", 0, 0, "English", vec!["Valve"])).unwrap();

        assert!(compute_rank_score(&valve) > compute_rank_score(&generic));
    }

    #[test]
    fn tie_breaker_penalizes_modern() {
        let old = serde_json::to_string(&make_data(15000, "2008", 0, 0, "", vec!["X"])).unwrap();

        let new = serde_json::to_string(&make_data(3000000, "2024", 0, 0, "", vec!["X"])).unwrap();

        assert!(compute_rank_score(&old) > compute_rank_score(&new));
    }
}
