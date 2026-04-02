//! Consultas de solo lectura sobre [`steam_catalog_apps`](crate::sqlite).

use rusqlite::{params_from_iter, Connection, Row};

use super::normalize::{escape_like_pattern, search_phrase_and_tokens};
use super::types::{CatalogFilterFacet, CatalogFilterFacets, CatalogListItem, CatalogPage};

fn map_catalog_row(row: &Row<'_>) -> Result<CatalogListItem, rusqlite::Error> {
    let id: i64 = row.get(0)?;
    Ok(CatalogListItem {
        steam_app_id: id.to_string(),
        name: row.get(1)?,
    })
}

/// Etiqueta legible de un elemento de `json_each` sobre `genres` / `categories`:
/// objetos Steam `{ "id", "description" }` o, si no aplica, el valor en bruto.
/// Evita `json_extract` sobre texto no JSON (evita "malformed JSON" en SQLite).
fn json_facet_label_expr(elem_alias: &str) -> String {
    format!(
        "CASE \
           WHEN json_valid({alias}.value) AND json_type({alias}.value) = 'object' \
             THEN COALESCE(NULLIF(json_extract({alias}.value, '$.description'), ''), {alias}.value) \
           ELSE {alias}.value \
         END",
        alias = elem_alias
    )
}

/// Argumento seguro para `json_each`: solo el array en `path` si el documento es JSON válido y el
/// valor es un array; si no, `'[]'`. Así el planificador no aplica `json_each`/`json_extract` a texto
/// corrupto o a un campo que no es array (causa habitual de "malformed JSON").
fn json_array_at_path_or_empty(table_alias: &str, path: &'static str) -> String {
    format!(
        "CASE \
           WHEN json_valid({alias}.details_json) \
             AND json_type(json_extract({alias}.details_json, '{path}')) = 'array' \
             THEN json_extract({alias}.details_json, '{path}') \
           ELSE '[]' END",
        alias = table_alias,
        path = path,
    )
}

fn append_json_genre_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    genres: &[String],
    table_alias: &str,
) {
    if genres.is_empty() {
        return;
    }
    let label = json_facet_label_expr("_gf");
    let genres_json = json_array_at_path_or_empty(table_alias, "$.genres");
    sql.push_str(&format!(
        " AND EXISTS (SELECT 1 FROM json_each({genres_json}) AS _gf WHERE ({label}) IN (",
    ));
    for (i, _) in genres.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push('?');
        params.push(genres[i].clone());
    }
    sql.push_str("))");
}

fn append_json_tag_filter(
    sql: &mut String,
    params: &mut Vec<String>,
    tags: &[String],
    table_alias: &str,
) {
    if tags.is_empty() {
        return;
    }
    let label = json_facet_label_expr("_tf");
    let categories_json = json_array_at_path_or_empty(table_alias, "$.categories");
    sql.push_str(&format!(
        " AND EXISTS (SELECT 1 FROM json_each({categories_json}) AS _tf WHERE ({label}) IN (",
    ));
    for (i, _) in tags.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push('?');
        params.push(tags[i].clone());
    }
    sql.push_str("))");
}

/// Recuento de filas que cumplen filtros por JSON enriquecido (`details_json`).
pub fn count_catalog_filtered(
    conn: &Connection,
    genres: &[String],
    tags: &[String],
) -> Result<u64, rusqlite::Error> {
    let mut sql = String::from("SELECT COUNT(*) FROM steam_catalog_apps WHERE 1=1");
    let mut params: Vec<String> = Vec::new();
    append_json_genre_filter(&mut sql, &mut params, genres, "steam_catalog_apps");
    append_json_tag_filter(&mut sql, &mut params, tags, "steam_catalog_apps");

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

/// Fragmento `ORDER BY` compartido entre listado paginado y búsqueda (después de tendencia).
///
/// Tras las filas de [`steam_catalog_trending`], el orden ya no es solo `app_id` (eso mezcla IDs altos
/// recientes con títulos irrelevantes). Priorizamos ficha enriquecida (`details_json`), luego
/// `enriched_at`, luego actividad del seed, y `app_id` solo como desempate.
fn order_by_after_trending(table_alias: &str) -> String {
    format!(
        "(tr.rank IS NOT NULL) DESC, tr.rank ASC, \
         ({alias}.details_json IS NOT NULL AND length(trim({alias}.details_json)) > 0) DESC, \
         {alias}.enriched_at DESC NULLS LAST, \
         {alias}.last_sync_batch_at DESC, \
         {alias}.app_id DESC",
        alias = table_alias
    )
}

/// Listado: primero juegos con ranking de tendencia (`steam_catalog_trending`, sync desde la tienda),
/// luego el resto con mejor orden que un simple `app_id` descendente (ver [`order_by_after_trending`]).
pub fn list_catalog_page_filtered(
    conn: &Connection,
    offset: u32,
    limit: u32,
    genres: &[String],
    tags: &[String],
) -> Result<Vec<CatalogListItem>, rusqlite::Error> {
    let mut sql = String::from(
        "SELECT a.app_id, a.name FROM steam_catalog_apps a \
         LEFT JOIN steam_catalog_trending tr ON tr.app_id = a.app_id \
         WHERE 1=1",
    );
    let mut params: Vec<String> = Vec::new();
    append_json_genre_filter(&mut sql, &mut params, genres, "a");
    append_json_tag_filter(&mut sql, &mut params, tags, "a");
    sql.push_str(" ORDER BY ");
    sql.push_str(&order_by_after_trending("a"));
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut stmt = conn.prepare(&sql)?;
    let rows = if params.is_empty() {
        stmt.query_map([], map_catalog_row)?
    } else {
        stmt.query_map(
            params_from_iter(params.iter().map(|s| s.as_str())),
            map_catalog_row,
        )?
    };
    rows.collect()
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

/// Búsqueda por tokens (AND) sobre `name_normalized`, orden por relevancia y luego tendencia.
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

    let mut sql = String::from(
        "SELECT a.app_id, a.name FROM steam_catalog_apps a \
         LEFT JOIN steam_catalog_trending tr ON tr.app_id = a.app_id \
         WHERE a.name_normalized IS NOT NULL AND length(trim(a.name_normalized)) > 0",
    );
    let mut params: Vec<String> = Vec::new();
    for token in &tokens {
        sql.push_str(" AND a.name_normalized LIKE ? ESCAPE '\\'");
        params.push(format!("%{}%", escape_like_pattern(token)));
    }
    append_json_genre_filter(&mut sql, &mut params, genres, "a");
    append_json_tag_filter(&mut sql, &mut params, tags, "a");

    let phrase_esc = escape_like_pattern(&phrase);
    sql.push_str(" ORDER BY ");
    sql.push_str("(CASE WHEN a.name_normalized LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END) ASC, ");
    sql.push_str("(CASE WHEN a.name_normalized LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END) ASC, ");
    sql.push_str("COALESCE(NULLIF(instr(a.name_normalized, ?), 0), 999999) ASC, ");
    sql.push_str("length(a.name_normalized) ASC, ");
    sql.push_str(&order_by_after_trending("a"));
    sql.push_str(" LIMIT ");
    sql.push_str(&limit.to_string());

    params.push(format!("%{}%", phrase_esc));
    params.push(format!("{}%", phrase_esc));
    params.push(phrase);

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params_from_iter(params.iter().map(|s| s.as_str())),
        map_catalog_row,
    )?;
    rows.collect()
}

/// Facetas desde `details_json` (apps enriquecidas). Etiquetas = categorías Steam (`categories`).
pub fn filter_facets(conn: &Connection) -> Result<CatalogFilterFacets, rusqlite::Error> {
    let g_label = json_facet_label_expr("g");
    let genres_arg = json_array_at_path_or_empty("steam_catalog_apps", "$.genres");
    let genres_sql = format!(
        "SELECT {g_label} AS label, COUNT(DISTINCT steam_catalog_apps.app_id) AS cnt \
         FROM steam_catalog_apps, \
              json_each({genres_arg}) AS g \
         WHERE steam_catalog_apps.details_json IS NOT NULL \
           AND length(trim(steam_catalog_apps.details_json)) > 0 \
           AND length(trim({g_label})) > 0 \
         GROUP BY 1 \
         ORDER BY cnt DESC, label COLLATE NOCASE ASC",
    );

    let t_label = json_facet_label_expr("t");
    let categories_arg = json_array_at_path_or_empty("steam_catalog_apps", "$.categories");
    let tags_sql = format!(
        "SELECT {t_label} AS label, COUNT(DISTINCT steam_catalog_apps.app_id) AS cnt \
         FROM steam_catalog_apps, \
              json_each({categories_arg}) AS t \
         WHERE steam_catalog_apps.details_json IS NOT NULL \
           AND length(trim(steam_catalog_apps.details_json)) > 0 \
           AND length(trim({t_label})) > 0 \
         GROUP BY 1 \
         ORDER BY cnt DESC, label COLLATE NOCASE ASC",
    );

    let genres = collect_facet_rows(conn, &genres_sql)?;
    let tags = collect_facet_rows(conn, &tags_sql)?;

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
