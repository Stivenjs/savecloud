//! Scoring de relevancia derivado exclusivamente de los datos ya presentes en `details_json`.
//!
//! # Diseño
//!
//! El score es un entero `0..=1_000_000` almacenado en `steam_catalog_apps.catalog_rank_score`.
//! Un valor más alto significa "más relevante": la columna se ordena **DESC** en las consultas
//! de listado, garantizando que cada página del catálogo mantenga la misma calidad relativa.
//!
//! ## Señales y pesos
//!
//! | Señal               | Peso máx. | Fuente en `details_json`                          |
//! |---------------------|-----------|---------------------------------------------------|
//! | Recencia            |   400 pts | `release_date.date` (año/mes parseado)            |
//! | Calidad de ficha    |   300 pts | presencia de descripción, géneros, screenshots    |
//! | Riqueza de medios   |   150 pts | nº de screenshots + vídeo disponible              |
//! | Señales de calidad  |   150 pts | desarrollador conocido, categorías premium, etc.  |
//!
//! ## Recencia
//!
//! Usa un decaimiento exponencial suave: juegos del año actual obtienen el máximo,
//! y el score cae ~50 pts por año de antigüedad hasta un mínimo de 0.
//! Soporta múltiples formatos de fecha que Steam usa históricamente:
//! `"DD Mon YYYY"`, `"Mon YYYY"`, `"YYYY"`.
//!
//! ## Calidad de ficha (proxy de popularidad)
//!
//! Sin acceso a reviews ni ventas, usamos la *completitud* de los metadatos como proxy:
//! - Un juego popular tiende a tener ficha completa (descripción larga, géneros, media).
//! - Un juego oscuro/abandonado suele tener campos vacíos o mínimos.
//!
//! ## Apps sin `details_json`
//!
//! Reciben `score = 0` y quedan al final del listado, después de todos los enriquecidos.

use rusqlite::Connection;

/// Score máximo asignable.
pub const MAX_SCORE: i64 = 1_000_000;

/// Año de referencia para el cálculo de recencia. Se actualiza automáticamente en compilación.
/// En runtime usamos el año del sistema para que el worker diario siempre use el año correcto;
/// esta constante solo sirve como fallback en contextos sin `std::time`.
#[allow(dead_code)]
const REFERENCE_YEAR: i32 = 2025;

// Pesos

const WEIGHT_RECENCY: i64 = 400;
const WEIGHT_RICHNESS: i64 = 300;
const WEIGHT_MEDIA: i64 = 150;
const WEIGHT_QUALITY_SIGNALS: i64 = 150;

// Parsing de fecha

/// Meses abreviados en inglés (Steam siempre usa inglés en `release_date` aunque la petición sea en otro idioma).
const MONTH_ABBR: &[&str] = &[
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn month_from_abbr(s: &str) -> Option<i32> {
    let lower = s.to_ascii_lowercase();
    MONTH_ABBR
        .iter()
        .position(|&m| m == lower.as_str())
        .map(|i| i as i32 + 1)
}

/// Devuelve `(year, month_1_12)` desde la cadena de fecha de Steam.
/// Formatos soportados: `"21 Nov 2019"`, `"Nov 2019"`, `"2019"`, `"Q4 2019"`.
fn parse_steam_date(s: &str) -> Option<(i32, i32)> {
    let s = s.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("coming soon") || s.eq_ignore_ascii_case("tbd") {
        return None;
    }

    let parts: Vec<&str> = s.split_whitespace().collect();
    match parts.as_slice() {
        // "21 Nov 2019"
        [_day, mon, year] => {
            let y = year.parse::<i32>().ok()?;
            let m = month_from_abbr(mon).unwrap_or(6);
            Some((y, m))
        }
        // "Nov 2019"
        [mon, year] if month_from_abbr(mon).is_some() => {
            let y = year.parse::<i32>().ok()?;
            let m = month_from_abbr(mon).unwrap_or(6);
            Some((y, m))
        }
        // "2019" o "Q4 2019"
        [year] => {
            let y = year.parse::<i32>().ok()?;
            Some((y, 6))
        }
        [quarter, year] if quarter.starts_with('Q') || quarter.starts_with('q') => {
            let y = year.parse::<i32>().ok()?;
            Some((y, 6))
        }
        _ => None,
    }
}

// Componentes del score

/// Score de recencia: decaimiento lineal de 400 pts (año actual) → 0 (hace ≥8 años o más antiguo).
/// Meses dentro del año añaden hasta ~33 pts adicionales de granularidad.
fn recency_score(data: &serde_json::Value, reference_year: i32) -> i64 {
    let date_str = data
        .get("release_date")
        .and_then(|rd| rd.get("date"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let Some((year, month)) = parse_steam_date(date_str) else {
        // Sin fecha: score neutro bajo (no castigar apps sin fecha pero sí priorizarlas menos).
        return WEIGHT_RECENCY / 8;
    };

    // Años futuros (coming soon con fecha) tratados como este año.
    let year = year.min(reference_year);

    let years_old = (reference_year - year).max(0) as i64;

    // Decaimiento: pierde 50 pts/año durante los primeros 8 años; después, 0.
    let year_score = (WEIGHT_RECENCY - years_old * 50).max(0);

    // Granularidad por mes: divide el año en 12 franjas (el mes 1 añade menos, el 12 añade más).
    // Efecto máximo: ±~33 pts dentro del mismo año, suficiente para desempatar sin distorsionar.
    let month_bonus = if years_old == 0 {
        ((month as i64 - 1) * (WEIGHT_RECENCY / 120)).min(WEIGHT_RECENCY / 12)
    } else {
        0
    };

    year_score + month_bonus
}

/// Score de riqueza de ficha: completitud de metadatos como proxy de popularidad.
///
/// Racionale: los juegos populares casi siempre tienen ficha completa en Steam.
/// Un juego oscuro o abandonado suele carecer de descripción detallada o géneros.
fn richness_score(data: &serde_json::Value) -> i64 {
    let mut score: i64 = 0;

    // Descripción corta (100 pts si existe y tiene sustancia)
    let short_desc = data
        .get("short_description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if short_desc.len() > 30 {
        score += 100;
    } else if !short_desc.is_empty() {
        score += 40;
    }

    // Descripción larga (80 pts si es sustancial — proxy de que el dev cuidó la ficha)
    let long_desc = data
        .get("detailed_description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if long_desc.len() > 200 {
        score += 80;
    } else if long_desc.len() > 50 {
        score += 30;
    }

    // Géneros presentes (60 pts si tiene al menos uno)
    let has_genres = data
        .get("genres")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if has_genres {
        score += 60;
    }

    // Desarrollador conocido (30 pts si tiene al menos un developer listado)
    let has_dev = data
        .get("developers")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if has_dev {
        score += 30;
    }

    // Publisher diferente al developer (30 pts — señal de publicación comercial)
    let devs: Vec<&str> = data
        .get("developers")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let pubs: Vec<&str> = data
        .get("publishers")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let has_distinct_publisher = !pubs.is_empty() && pubs.iter().any(|p| !devs.contains(p));
    if has_distinct_publisher {
        score += 30;
    }

    score.min(WEIGHT_RICHNESS)
}

/// Score de medios: número de screenshots y presencia de vídeo.
fn media_score(data: &serde_json::Value) -> i64 {
    let screenshots = data
        .get("screenshots")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    let has_video = data
        .get("movies")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());

    // Vídeo: 80 pts (los juegos populares casi siempre tienen tráiler)
    // Screenshots: hasta 70 pts escalados (>10 capturas = máximo)
    let video_pts: i64 = if has_video { 80 } else { 0 };
    let shot_pts: i64 = ((screenshots.min(10) as i64) * 7).min(70);

    (video_pts + shot_pts).min(WEIGHT_MEDIA)
}

/// Señales de calidad inferibles: categorías Steam que correlacionan con juegos de mayor calidad percibida.
///
/// Steam almacena features en `categories` (multi-jugador, logros, trading cards, etc.).
/// Tener estas features correlaciona positivamente con juegos que recibieron inversión.
fn quality_signals_score(data: &serde_json::Value) -> i64 {
    let categories: Vec<&str> = data
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|item| item.as_str()).collect())
        .unwrap_or_default();

    // Si categories son objetos con campo `description` (formato Steam real)
    let cat_descriptions: Vec<String> = data
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|item| {
                    item.get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_ascii_lowercase())
                        .or_else(|| item.as_str().map(|s| s.to_ascii_lowercase()))
                })
                .collect()
        })
        .unwrap_or_default();

    let _ = categories; // usamos cat_descriptions que normaliza ambos formatos

    let mut score: i64 = 0;

    // Logros de Steam: 40 pts — casi todos los juegos AAA/AA los tienen
    if cat_descriptions
        .iter()
        .any(|c| c.contains("achievement") || c.contains("logro"))
    {
        score += 40;
    }

    // Multi-jugador (online o local): 35 pts — reduce la presencia de shovelware
    if cat_descriptions
        .iter()
        .any(|c| c.contains("multi") || c.contains("online") || c.contains("co-op"))
    {
        score += 35;
    }

    // Steam Cloud: 30 pts — desarrolladores que implementan SDK completo
    if cat_descriptions.iter().any(|c| c.contains("cloud")) {
        score += 30;
    }

    // Controller support: 25 pts — correlaciona con juegos bien terminados
    if cat_descriptions
        .iter()
        .any(|c| c.contains("controller") || c.contains("full controller"))
    {
        score += 25;
    }

    // Trading cards: 20 pts — requiere volumen de ventas mínimo para activarlas
    if cat_descriptions.iter().any(|c| c.contains("trading card")) {
        score += 20;
    }

    score.min(WEIGHT_QUALITY_SIGNALS)
}

// Función principal

/// Calcula el `catalog_rank_score` `[0, 1_000_000]` desde el objeto `data` de `appdetails`.
///
/// Acepta tanto el JSON crudo de la Store (`details_json` guardado por el worker) como
/// el formato serializado de [`SteamAppDetails`]; ambos exponen `release_date`, `genres`, etc.
pub fn compute_rank_score(details_json: &str) -> i64 {
    let Ok(data) = serde_json::from_str::<serde_json::Value>(details_json) else {
        return 0;
    };
    let data = match &data {
        serde_json::Value::Object(_) => &data,
        _ => return 0,
    };

    // Año de referencia: año del sistema en el momento en que corre el worker.
    let reference_year = current_year();

    let r = recency_score(data, reference_year);
    let ri = richness_score(data);
    let m = media_score(data);
    let q = quality_signals_score(data);

    (r + ri + m + q).min(MAX_SCORE).max(0)
}

fn current_year() -> i32 {
    // Usa SystemTime para que el worker diario use siempre el año correcto.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Aproximación suficientemente precisa: 365.2425 días/año.
    let years_since_1970 = (secs as f64 / (365.2425 * 86_400.0)) as i32;
    1970 + years_since_1970
}

// Persistencia en SQLite

/// Recalcula `catalog_rank_score` para todas las apps con `details_json` no nulo.
///
/// Diseñado para ejecutarse como backfill en el arranque del worker o tras una migración.
/// Usa una transacción única con `prepare_cached` para minimizar overhead I/O.
pub fn backfill_rank_scores(conn: &Connection) -> Result<u32, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT app_id, details_json FROM steam_catalog_apps WHERE details_json IS NOT NULL AND length(trim(details_json)) > 2")?;

    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let tx = conn.unchecked_transaction()?;
    let mut updated: u32 = 0;
    {
        let mut upd = tx.prepare_cached(
            "UPDATE steam_catalog_apps SET catalog_rank_score = ?1 WHERE app_id = ?2",
        )?;
        for (app_id, json) in &rows {
            let score = compute_rank_score(json);
            upd.execute(rusqlite::params![score, app_id])?;
            updated += 1;
        }
    }
    tx.commit()?;
    Ok(updated)
}

/// Actualiza `catalog_rank_score` solo para los `app_id` del batch activo.
///
/// Invocado al final de [`crate::steam_seed::apply_seed_updates`] sobre `_seed_batch_ids`,
/// de modo que cada importación incremental actualiza los scores sin tocar todo el catálogo.
pub fn update_rank_scores_for_batch(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Lee los app_ids del batch temporal registrado por apply_seed_updates.
    let mut stmt = conn.prepare(
        "SELECT a.app_id, a.details_json
         FROM steam_catalog_apps a
         JOIN _seed_batch_ids b ON b.app_id = a.app_id
         WHERE a.details_json IS NOT NULL AND length(trim(a.details_json)) > 2",
    )?;

    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let mut upd = conn.prepare_cached(
        "UPDATE steam_catalog_apps SET catalog_rank_score = ?1 WHERE app_id = ?2",
    )?;
    for (app_id, json) in &rows {
        let score = compute_rank_score(json);
        upd.execute(rusqlite::params![score, app_id])?;
    }
    Ok(())
}

/// Actualiza `catalog_rank_score` para una sola app (llamado desde enrichment tras fetch individual).
#[allow(dead_code)]
pub fn update_rank_score_single(
    conn: &Connection,
    app_id: u32,
    details_json: &str,
) -> Result<(), rusqlite::Error> {
    let score = compute_rank_score(details_json);
    conn.execute(
        "UPDATE steam_catalog_apps SET catalog_rank_score = ?1 WHERE app_id = ?2",
        rusqlite::params![score, app_id],
    )?;
    Ok(())
}

// Tests

#[cfg(test)]
mod tests {
    use super::*;

    fn make_data(
        year: &str,
        short_desc: &str,
        screenshots: usize,
        video: bool,
    ) -> serde_json::Value {
        let shots: Vec<serde_json::Value> = (0..screenshots)
            .map(|i| serde_json::json!({ "path_full": format!("https://example.com/{i}.jpg") }))
            .collect();
        let movies = if video {
            serde_json::json!([{ "mp4": { "max": "https://example.com/trailer.mp4" } }])
        } else {
            serde_json::json!([])
        };
        serde_json::json!({
            "release_date": { "date": year },
            "short_description": short_desc,
            "detailed_description": "A".repeat(300),
            "genres": [{ "description": "Action" }],
            "developers": ["Dev Studio"],
            "publishers": ["Big Publisher"],
            "categories": [
                { "description": "Steam Achievements" },
                { "description": "Full controller support" }
            ],
            "screenshots": shots,
            "movies": movies
        })
    }

    #[test]
    fn recent_game_scores_higher_than_old() {
        let new_json = serde_json::to_string(&make_data(
            "15 Nov 2024",
            "A great game with lots of features",
            12,
            true,
        ))
        .unwrap();
        let old_json =
            serde_json::to_string(&make_data("1 Jan 2005", "Old game", 2, false)).unwrap();
        assert!(compute_rank_score(&new_json) > compute_rank_score(&old_json));
    }

    #[test]
    fn rich_metadata_scores_more_than_sparse() {
        let rich = serde_json::to_string(&make_data(
            "1 Jan 2020",
            "Very detailed description with many features and gameplay info",
            10,
            true,
        ))
        .unwrap();
        let sparse = serde_json::to_string(&serde_json::json!({
            "release_date": { "date": "1 Jan 2020" },
            "short_description": "",
            "genres": [],
            "developers": [],
            "screenshots": [],
            "movies": []
        }))
        .unwrap();
        assert!(compute_rank_score(&rich) > compute_rank_score(&sparse));
    }

    #[test]
    fn score_bounded() {
        let rich = serde_json::to_string(&make_data("2025", "Full game", 15, true)).unwrap();
        let score = compute_rank_score(&rich);
        assert!(score >= 0 && score <= MAX_SCORE);
    }

    #[test]
    fn invalid_json_returns_zero() {
        assert_eq!(compute_rank_score("not json"), 0);
        assert_eq!(compute_rank_score(""), 0);
    }

    #[test]
    fn parse_various_date_formats() {
        assert_eq!(parse_steam_date("21 Nov 2019"), Some((2019, 11)));
        assert_eq!(parse_steam_date("Nov 2019"), Some((2019, 11)));
        assert_eq!(parse_steam_date("2019"), Some((2019, 6)));
        assert_eq!(parse_steam_date("Coming Soon"), None);
        assert_eq!(parse_steam_date(""), None);
    }
}
