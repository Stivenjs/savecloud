//! Consultas de solo lectura sobre [`steam_catalog_apps`](crate::sqlite).
//!
//! # Estrategia de ordenamiento
//!
//! El listado paginado usa `catalog_rank_score DESC` como criterio principal,
//! garantizando que **todas las páginas** mantengan la misma calidad relativa.
//! El score es un entero `[0, 1_000_000]` calculado por [`crate::steam_catalog::scoring`]
//! usando únicamente los datos de `details_json` ya persistidos.
//!
//! ## Orden de prioridad en el listado
//!
//! 1. **Tendencias** (`steam_catalog_trending`): siempre al frente, ordenadas por `rank ASC`.
//! 2. **Resto del catálogo enriquecido**: `catalog_rank_score DESC` → `enriched_at DESC` → `app_id DESC`.
//! 3. **Sin enriquecer** (`details_json IS NULL`, `score = 0`): al final, por `app_id DESC`.
//!
//! ## Paginación estable
//!
//! El score se persiste en disco; no varía entre peticiones, por lo que el offset
//! sobre la lista ordenada es determinístico y no produce "saltos" entre páginas.

use rusqlite::{params_from_iter, Connection, Row};

use super::normalize::{escape_like_pattern, search_phrase_and_tokens};
use super::types::{CatalogFilterFacet, CatalogFilterFacets, CatalogListItem, CatalogPage};

/// Número máximo de filas que COUNT evalúa cuando hay filtros activos.
/// Suficiente para la paginación de UI; evita un full-scan sobre el catálogo completo.
const COUNT_CAP: u64 = 50_000;

fn map_catalog_row(row: &Row<'_>) -> Result<CatalogListItem, rusqlite::Error> {
    let id: i64 = row.get(0)?;
    Ok(CatalogListItem {
        steam_app_id: id.to_string(),
        name: row.get(1)?,
    })
}

/// Devuelve el bloque superior de tendencias para el hero del catálogo.
///
/// Ordena por `rank ASC` y limita el tamaño para mantener el payload pequeño
/// en la primera vista de la tienda.
pub fn list_catalog_trending_hero(
    conn: &Connection,
    limit: u32,
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT a.app_id, a.name \
         FROM steam_catalog_trending tr \
         JOIN steam_catalog_apps a ON a.app_id = tr.app_id \
         ORDER BY tr.rank ASC \
         LIMIT ?1",
    )?;

    let rows = stmt.query_map([limit as i64], map_catalog_row)?;
    rows.collect()
}

/// Añade un EXISTS por cada género (semántica AND: la app debe tener TODOS).
///
/// Usa la subquery correlacionada:
/// `EXISTS (SELECT 1 FROM steam_app_genres WHERE app_id = <alias>.app_id AND label = ?)`
///
/// Requiere el índice `idx_steam_app_genres_appid_label (app_id, label)` para que
/// SQLite resuelva cada EXISTS con una búsqueda puntual en O(log n).
fn append_genre_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    genres: &[String],
    table_alias: &str,
) {
    for genre in genres {
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM steam_app_genres \
              WHERE app_id = {table_alias}.app_id AND label = ?)"
        ));
        params.push(genre.clone());
    }
}

/// Añade un EXISTS por cada tag (semántica AND: la app debe tener TODOS).
///
/// Mismo patrón que `append_genre_filter`; requiere
/// `idx_steam_app_tags_appid_label (app_id, label)`.
fn append_tag_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    tags: &[String],
    table_alias: &str,
) {
    for tag in tags {
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM steam_app_tags \
              WHERE app_id = {table_alias}.app_id AND label = ?)"
        ));
        params.push(tag.clone());
    }
}

/// Recuento de filas que cumplen los filtros, acotado a `COUNT_CAP`.
///
/// Cuando no hay filtros activos el total exacto es inmediato (stat de SQLite).
/// Con filtros se recorre hasta `COUNT_CAP` filas; si las hay más, se devuelve
/// `COUNT_CAP` como estimación conservadora (suficiente para la UI).
///
/// Esto elimina el full-scan que en el código original bloqueaba durante segundos
/// cuando un tag popular tenía decenas de miles de resultados.
pub fn count_catalog_filtered(
    conn: &Connection,
    genres: &[String],
    tags: &[String],
) -> Result<u64, rusqlite::Error> {
    if genres.is_empty() && tags.is_empty() {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM steam_catalog_apps", [], |r| r.get(0))?;
        return Ok(n as u64);
    }

    let mut sql = "SELECT COUNT(*) FROM (\
           SELECT 1 FROM steam_catalog_apps WHERE 1=1".to_string();
    let mut params: Vec<String> = Vec::new();
    append_genre_filter(&mut sql, &mut params, genres, "steam_catalog_apps");
    append_tag_filter(&mut sql, &mut params, tags, "steam_catalog_apps");
    sql.push_str(&format!(" LIMIT {COUNT_CAP})"));

    let count: i64 = conn.query_row(
        &sql,
        params_from_iter(params.iter().map(|s| s.as_str())),
        |r| r.get(0),
    )?;
    Ok(count as u64)
}

/// Listado paginado usando split queries para máximo rendimiento.
///
/// # Algoritmo
///
/// 1. **Tendencias** — se extraen completas (pocos registros), se aplica el slice de paginación.
/// 2. **Catálogo general** — ordenado por `catalog_rank_score DESC, enriched_at DESC, app_id DESC`.
///    Este orden coincide con el índice `idx_catalog_rank_sort` definido en la migración,
///    por lo que SQLite responde con un B-Tree scan sin `filesort`.
///
/// El resultado compuesto preserva calidad en todas las páginas: la página 100 tendrá
/// juegos con score similar a la página 2, en lugar de mostrar apps sin metadatos.
pub fn list_catalog_page_filtered(
    conn: &Connection,
    offset: u32,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let mut results = Vec::new();

    let mut t_sql = String::from(
        "SELECT a.app_id, a.name \
         FROM steam_catalog_trending tr \
         JOIN steam_catalog_apps a ON a.app_id = tr.app_id \
         WHERE 1=1",
    );
    let mut t_params: Vec<String> = Vec::new();
    append_genre_filter(&mut t_sql, &mut t_params, genres, "a");
    append_tag_filter(&mut t_sql, &mut t_params, tags, "a");
    t_sql.push_str(" ORDER BY tr.rank ASC");

    let mut stmt_t = conn.prepare(&t_sql)?;
    let trending_items: Vec<CatalogListItem> = if t_params.is_empty() {
        stmt_t
            .query_map([], map_catalog_row)?
            .filter_map(Result::ok)
            .collect()
    } else {
        stmt_t
            .query_map(params_from_iter(t_params.iter()), map_catalog_row)?
            .filter_map(Result::ok)
            .collect()
    };

    let t_count = trending_items.len() as u32;

    if offset < t_count {
        let take = std::cmp::min(limit, t_count - offset);
        results.extend(
            trending_items
                .into_iter()
                .skip(offset as usize)
                .take(take as usize),
        );
    }

    if results.len() < limit as usize {
        let remaining_limit = limit - results.len() as u32;
        let normal_offset = offset.saturating_sub(t_count);

        let mut n_sql = String::from(
            "SELECT a.app_id, a.name \
             FROM steam_catalog_apps a \
             WHERE NOT EXISTS \
               (SELECT 1 FROM steam_catalog_trending WHERE app_id = a.app_id)",
        );
        let mut n_params: Vec<String> = Vec::new();
        append_genre_filter(&mut n_sql, &mut n_params, genres, "a");
        append_tag_filter(&mut n_sql, &mut n_params, tags, "a");

        n_sql.push_str(" ORDER BY a.catalog_rank_score DESC, a.enriched_at DESC, a.app_id DESC");
        n_sql.push_str(&format!(" LIMIT {remaining_limit} OFFSET {normal_offset}"));

        let mut stmt_n = conn.prepare(&n_sql)?;
        let normal_items = if n_params.is_empty() {
            stmt_n.query_map([], map_catalog_row)?
        } else {
            stmt_n.query_map(params_from_iter(n_params.iter()), map_catalog_row)?
        };

        for item in normal_items {
            results.push(item?);
        }
    }

    Ok(results)
}

/// Página completa: total acotado + items.
///
/// Si `cached_total` es `Some(n)`, se reutiliza ese valor sin ejecutar
/// el COUNT (evita el full-scan cuando el frontend ya conoce el total
/// por haber consultado la primera página con los mismos filtros).
pub fn catalog_page_filtered(
    conn: &Connection,
    offset: u32,
    limit: u32,
    genres: &[String],
    tags: &[String],
    cached_total: Option<u64>,
) -> Result<CatalogPage, rusqlite::Error> {
    let total = match cached_total {
        Some(n) => n,
        None => count_catalog_filtered(conn, genres, tags)?,
    };
    let items = list_catalog_page_filtered(conn, offset, limit, genres, tags)?;
    Ok(CatalogPage {
        total,
        offset,
        limit,
        items,
    })
}

/// Búsqueda por tokens con orden híbrido: señal léxica (exacta/prefijo) → score → relevancia FTS.
///
/// Para consultas cortas (p. ej. "god"), se prioriza que aparezcan antes títulos
/// más fuertes cuando además coinciden como prefijo de nombre.
///
/// Los filtros de género/tag se aplican con EXISTS correlacionado, igual que en el listado.
pub fn search_catalog_filtered(
    conn: &Connection,
    q: &str,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let Some((phrase, tokens)) = search_phrase_and_tokens(q) else {
        return Ok(Vec::new());
    };

    let fts_match_query = tokens
        .iter()
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut sql = String::from(
        "SELECT a.app_id, a.name \
         FROM steam_catalog_search s \
         JOIN steam_catalog_apps a ON a.app_id = s.app_id \
         LEFT JOIN steam_catalog_trending tr ON tr.app_id = a.app_id \
         WHERE steam_catalog_search MATCH ?",
    );

    let phrase_like = escape_like_pattern(&phrase);
    let phrase_prefix = format!("{phrase_like}%");
    let phrase_contains = format!("% {phrase_like}%");

    let mut params: Vec<String> = vec![fts_match_query];
    append_genre_filter(&mut sql, &mut params, genres, "a");
    append_tag_filter(&mut sql, &mut params, tags, "a");
    params.push(phrase.clone());
    params.push(phrase_prefix);
    params.push(phrase_contains);

    sql.push_str(
        " ORDER BY \
          CASE \
            WHEN a.name_normalized = ? THEN 0 \
            WHEN a.name_normalized LIKE ? ESCAPE '\\' THEN 1 \
            WHEN a.name_normalized LIKE ? ESCAPE '\\' THEN 2 \
            ELSE 3 \
          END ASC, \
          a.catalog_rank_score DESC, \
          s.rank ASC, \
          (tr.rank IS NOT NULL) DESC, \
          tr.rank ASC, \
          a.enriched_at DESC",
    );
    sql.push_str(&format!(" LIMIT {limit}"));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params_from_iter(params.iter().map(|s| s.as_str())),
        map_catalog_row,
    )?;

    rows.collect()
}

/// Facetas desde las tablas indexadas `steam_app_genres` y `steam_app_tags`.
///
/// Se limita a las primeras 200 etiquetas más populares para que la UI no se
/// sature; ajustar `FACET_LIMIT` si se necesitan más.
pub fn filter_facets(conn: &Connection) -> Result<CatalogFilterFacets, rusqlite::Error> {
    const FACET_LIMIT: usize = 200;

    let genres_sql = "
        SELECT label, COUNT(app_id) AS cnt
        FROM steam_app_genres
        GROUP BY label
        ORDER BY cnt DESC, label COLLATE NOCASE ASC
        LIMIT ?1
    ";

    let tags_sql = "
        SELECT label, COUNT(app_id) AS cnt
        FROM steam_app_tags
        GROUP BY label
        ORDER BY cnt DESC, label COLLATE NOCASE ASC
        LIMIT ?1
    ";

    let genres = collect_facet_rows(conn, genres_sql, FACET_LIMIT)?;
    let tags = collect_facet_rows(conn, tags_sql, FACET_LIMIT)?;

    Ok(CatalogFilterFacets { genres, tags })
}

fn collect_facet_rows(
    conn: &Connection,
    sql: &str,
    limit: usize,
) -> Result<Vec<CatalogFilterFacet>, rusqlite::Error> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([limit as i64], |row| {
        Ok(CatalogFilterFacet {
            label: row.get(0)?,
            count: row.get::<_, i64>(1)? as u64,
        })
    })?;
    rows.collect()
}
