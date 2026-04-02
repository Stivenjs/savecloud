//! Normalización única de nombres para `name_normalized` y búsqueda en catálogo.

use rusqlite::Connection;
use unicode_normalization::UnicodeNormalization;

use super::meta::{get_meta, set_meta, META_NAME_NORMALIZED_BACKFILL};

/// Metadato: versión de la lógica de normalización; si cambia, se puede forzar otro backfill.
pub const NAME_NORMALIZED_LOGIC_VERSION: &str = "2";

/// Normaliza un título para indexación y búsqueda: minúsculas, sin marcas diacríticas,
/// puntuación y símbolos convertidos en separadores, espacios colapsados.
pub fn normalize_catalog_name(name: &str) -> String {
    let nfd: String = name
        .trim()
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();
    let lowered = nfd.to_lowercase();

    let mut out = String::with_capacity(lowered.len());
    let mut prev_space = false;
    for ch in lowered.chars() {
        if ch == '\'' || ch == '\u{2019}' || ch == '\u{2018}' {
            continue;
        }
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else if ch.is_alphanumeric() {
            out.push(ch);
            prev_space = false;
        } else {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Escapa `%`, `_` y `\` para usar en patrones `LIKE` con `ESCAPE '\'`.
pub fn escape_like_pattern(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Frase normalizada y tokens para `AND` en SQL. Tokens: longitud ≥ 2, o un solo dígito ASCII (p. ej. "5" en "gta 5").
pub fn search_phrase_and_tokens(q: &str) -> Option<(String, Vec<String>)> {
    let phrase = normalize_catalog_name(q.trim());
    if phrase.is_empty() {
        return None;
    }
    let tokens: Vec<String> = phrase
        .split_whitespace()
        .filter_map(|t| {
            if t.is_empty() {
                return None;
            }
            if t.len() >= 2 {
                return Some(t.to_string());
            }
            if t.len() == 1 && t.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return Some(t.to_string());
            }
            None
        })
        .collect();
    if tokens.is_empty() {
        return None;
    }
    Some((phrase, tokens))
}

/// Recomputa `name_normalized` para todas las filas si aún no se aplicó el backfill de la lógica v2.
pub fn backfill_name_normalized_if_needed(conn: &Connection) -> Result<(), rusqlite::Error> {
    if get_meta(conn, META_NAME_NORMALIZED_BACKFILL)?.as_deref()
        == Some(NAME_NORMALIZED_LOGIC_VERSION)
    {
        return Ok(());
    }

    let mut stmt = conn.prepare("SELECT app_id, name FROM steam_catalog_apps")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let tx = conn.unchecked_transaction()?;
    {
        let mut update = tx.prepare_cached(
            "UPDATE steam_catalog_apps SET name_normalized = ?1 WHERE app_id = ?2",
        )?;
        for (app_id, name) in rows {
            let nn = normalize_catalog_name(&name);
            update.execute(rusqlite::params![nn, app_id])?;
        }
    }
    tx.commit()?;
    set_meta(
        conn,
        META_NAME_NORMALIZED_BACKFILL,
        NAME_NORMALIZED_LOGIC_VERSION,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_punctuation_and_hyphens() {
        assert_eq!(normalize_catalog_name("Half-Life 2"), "half life 2");
        assert_eq!(normalize_catalog_name("  GTA:V  "), "gta v");
    }

    #[test]
    fn normalize_strips_diacritics() {
        assert_eq!(normalize_catalog_name("Pokémon"), "pokemon");
    }

    #[test]
    fn search_tokens_accepts_multi_word_and_digit() {
        let (phrase, tok) = search_phrase_and_tokens("gta 5").expect("tokens");
        assert_eq!(phrase, "gta 5");
        assert_eq!(tok, vec!["gta", "5"]);
    }

    #[test]
    fn search_tokens_rejects_only_short_letters() {
        assert!(search_phrase_and_tokens("a").is_none());
    }

    #[test]
    fn escape_like_escapes_wildcards() {
        assert_eq!(escape_like_pattern("50%"), "50\\%");
    }
}
