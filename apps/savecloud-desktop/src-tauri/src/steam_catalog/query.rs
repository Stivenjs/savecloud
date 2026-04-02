//! Consultas de solo lectura sobre [`steam_catalog_apps`](crate::sqlite).

use rusqlite::{params_from_iter, Connection, Row};

use super::normalize::search_phrase_and_tokens;
use super::types::{CatalogFilterFacet, CatalogFilterFacets, CatalogListItem, CatalogPage};

fn map_catalog_row(row: &Row<'_>) -> Result<CatalogListItem, rusqlite::Error> {
    let id: i64 = row.get(0)?;
    Ok(CatalogListItem {
        steam_app_id: id.to_string(),
        name: row.get(1)?,
    })
}

/// Filtro por género desde `steam_app_genres`.
fn append_genre_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    genres: &[String],
    table_alias: &str,
) {
    if genres.is_empty() {
        return;
    }
    sql.push_str(&format!(
        " AND {}.app_id IN (SELECT app_id FROM steam_app_genres WHERE label IN (",
        table_alias
    ));
    for (i, genre) in genres.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push('?');
        params.push(genre.clone());
    }
    sql.push_str("))");
}

/// Filtro por etiqueta desde `steam_app_tags`.
fn append_tag_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    tags: &[String],
    table_alias: &str,
) {
    if tags.is_empty() {
        return;
    }
    sql.push_str(&format!(
        " AND {}.app_id IN (SELECT app_id FROM steam_app_tags WHERE label IN (",
        table_alias
    ));
    for (i, tag) in tags.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push('?');
        params.push(tag.clone());
    }
    sql.push_str("))");
}

/// Recuento de filas que cumplen filtros.
pub fn count_catalog_filtered(
    conn: &Connection,
    genres: &[String],
    tags: &[String],
) -> Result<u64, rusqlite::Error> {
    let mut sql = String::from("SELECT COUNT(*) FROM steam_catalog_apps WHERE 1=1");
    let mut params: Vec<String> = Vec::new();
    append_genre_filter(&mut sql, &mut params, genres, "steam_catalog_apps");
    append_tag_filter(&mut sql, &mut params, tags, "steam_catalog_apps");

    let count: i64 = if params.is_empty() {
        conn.query_row(&sql, [], |row| row.get(0))?
    } else {
        conn.query_row(
            &sql,
            params_from_iter(params.iter().map(|s| s.as_str())),
            |row| row.get(0),
        )?
    };
    Ok(count as u64)
}

//// Listado ultra-optimizado usando Split Queries.
/// Calcula la paginación en Rust para evitar que SQLite tenga que ordenar todo el catálogo en memoria.
pub fn list_catalog_page_filtered(
    conn: &Connection,
    offset: u32,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let mut results = Vec::new();

    // 1. OBTENER TENDENCIAS (Aislado, súper rápido porque son pocos registros)
    let mut t_sql = String::from(
        "SELECT a.app_id, a.name FROM steam_catalog_trending tr \
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

    // Lógica inteligente de paginación para las tendencias
    if offset < t_count {
        let take = std::cmp::min(limit, t_count - offset);
        results.extend(
            trending_items
                .into_iter()
                .skip(offset as usize)
                .take(take as usize),
        );
    }

    // 2. OBTENER EL RESTO DEL CATÁLOGO (Usa nuestro nuevo Índice B-Tree pre-calculado)
    if results.len() < limit as usize {
        let remaining_limit = limit - results.len() as u32;
        let normal_offset = if offset >= t_count {
            offset - t_count
        } else {
            0
        };

        let mut n_sql = String::from(
            "SELECT a.app_id, a.name FROM steam_catalog_apps a \
             WHERE NOT EXISTS (SELECT 1 FROM steam_catalog_trending WHERE app_id = a.app_id)",
        );
        let mut n_params: Vec<String> = Vec::new();
        append_genre_filter(&mut n_sql, &mut n_params, genres, "a");
        append_tag_filter(&mut n_sql, &mut n_params, tags, "a");

        // Esto coincide EXACTAMENTE con `idx_catalog_fast_sort`. SQLite responderá en milisegundos.
        n_sql.push_str(" ORDER BY (a.details_json IS NOT NULL) DESC, a.enriched_at DESC, a.last_sync_batch_at DESC, a.app_id DESC");
        n_sql.push_str(&format!(
            " LIMIT {} OFFSET {}",
            remaining_limit, normal_offset
        ));

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

pub fn catalog_page_filtered(
    conn: &Connection,
    offset: u32,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<CatalogPage, rusqlite::Error> {
    let total = count_catalog_filtered(conn, genres, tags)?;
    let items = list_catalog_page_filtered(conn, offset, limit, genres, tags)?;
    Ok(CatalogPage {
        total,
        offset,
        limit,
        items,
    })
}

/// Búsqueda por tokens
pub fn search_catalog_filtered(
    conn: &Connection,
    q: &str,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let Some((_, tokens)) = search_phrase_and_tokens(q) else {
        return Ok(Vec::new());
    };

    let fts_match_query = tokens
        .iter()
        .map(|t| format!("\"{}\"*", t.replace('\"', "")))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut sql = String::from(
        "SELECT a.app_id, a.name FROM steam_catalog_search s \
         JOIN steam_catalog_apps a ON a.app_id = s.app_id \
         LEFT JOIN steam_catalog_trending tr ON tr.app_id = a.app_id \
         WHERE steam_catalog_search MATCH ?",
    );

    let mut params: Vec<String> = vec![fts_match_query];

    append_genre_filter(&mut sql, &mut params, genres, "a");
    append_tag_filter(&mut sql, &mut params, tags, "a");

    sql.push_str(
        " ORDER BY s.rank ASC, (tr.rank IS NOT NULL) DESC, tr.rank ASC, a.enriched_at DESC ",
    );
    sql.push_str(" LIMIT ");
    sql.push_str(&limit.to_string());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params_from_iter(params.iter().map(|s| s.as_str())),
        map_catalog_row,
    )?;

    rows.collect()
}

/// Facetas desde las tablas indexadas `steam_app_genres` y `steam_app_tags`.
pub fn filter_facets(conn: &Connection) -> Result<CatalogFilterFacets, rusqlite::Error> {
    let genres_sql = "
        SELECT label, COUNT(app_id) AS cnt 
        FROM steam_app_genres 
        GROUP BY label 
        ORDER BY cnt DESC, label COLLATE NOCASE ASC
    ";

    let tags_sql = "
        SELECT label, COUNT(app_id) AS cnt 
        FROM steam_app_tags 
        GROUP BY label 
        ORDER BY cnt DESC, label COLLATE NOCASE ASC
    ";

    let genres = collect_facet_rows(conn, genres_sql)?;
    let tags = collect_facet_rows(conn, tags_sql)?;

    Ok(CatalogFilterFacets { genres, tags })
}

fn collect_facet_rows(
    conn: &Connection,
    sql: &str,
) -> Result<Vec<CatalogFilterFacet>, rusqlite::Error> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(CatalogFilterFacet {
            label: row.get(0)?,
            count: row.get::<_, i64>(1)? as u64,
        })
    })?;
    rows.collect()
}
