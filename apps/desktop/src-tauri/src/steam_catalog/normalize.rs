//! Normalización única de nombres para `name_normalized` y búsqueda en catálogo.

use rusqlite::Connection;
use unicode_normalization::UnicodeNormalization;

use super::meta::{get_meta, set_meta, META_NAME_NORMALIZED_BACKFILL};

/// Metadato: versión de la lógica de normalización; si cambia, se puede forzar otro backfill.
pub const NAME_NORMALIZED_LOGIC_VERSION: &str = "1";

fn collapse_dotted_acronyms(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];
        if ch == '.' {
            let prev_is_single_alphanumeric = i > 0
                && chars[i - 1].is_alphanumeric()
                && (i == 1 || !chars[i - 2].is_alphanumeric() || chars[i - 2] == '.');
            let next_is_alphanumeric_or_end = (i + 1 < len && chars[i + 1].is_alphanumeric())
                || i + 1 == len
                || (i + 1 < len && chars[i + 1].is_whitespace());

            if prev_is_single_alphanumeric && next_is_alphanumeric_or_end {
                i += 1;
                continue;
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

/// Normaliza un título para indexación y búsqueda: minúsculas, sin marcas diacríticas,
/// acrónimos colapsados, puntuación y símbolos convertidos en separadores, espacios colapsados.
pub fn normalize_catalog_name(name: &str) -> String {
    let nfd: String = name
        .trim()
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();
    let lowered = nfd.to_lowercase();
    let collapsed = collapse_dotted_acronyms(&lowered);

    let mut out = String::with_capacity(collapsed.len());
    let mut prev_space = false;
    for ch in collapsed.chars() {
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

#[allow(dead_code)]
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

/// Frase normalizada y tokens para `AND` en SQL. Tokens: longitud ≥ 2, o un solo carácter alfanumérico si hay más de un término.
pub fn search_phrase_and_tokens(q: &str) -> Option<(String, Vec<String>)> {
    let phrase = normalize_catalog_name(q.trim());
    if phrase.is_empty() {
        return None;
    }
    let all_tokens: Vec<String> = phrase.split_whitespace().map(|t| t.to_string()).collect();

    if all_tokens.is_empty() {
        return None;
    }

    let tokens: Vec<String> = all_tokens
        .into_iter()
        .filter(|t| {
            if t.len() >= 2 {
                return true;
            }
            if t.len() == 1 && t.chars().next().is_some_and(|c| c.is_alphanumeric()) {
                return true;
            }
            false
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
    let mut rows_iter = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;

    loop {
        let batch: Vec<(i64, String)> = rows_iter.by_ref().take(5000).collect::<Result<_, _>>()?;
        if batch.is_empty() {
            break;
        }

        let tx = conn.unchecked_transaction()?;
        {
            let mut update = tx.prepare_cached(
                "UPDATE steam_catalog_apps SET name_normalized = ?1 WHERE app_id = ?2",
            )?;
            for (app_id, name) in batch {
                let nn = normalize_catalog_name(&name);
                update.execute(rusqlite::params![nn, app_id])?;
            }
        }
        tx.commit()?;
    }
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
    fn normalize_collapses_dotted_acronyms() {
        assert_eq!(normalize_catalog_name("S.T.A.L.K.E.R. 2"), "stalker 2");
        assert_eq!(normalize_catalog_name("F.E.A.R."), "fear");
        assert_eq!(normalize_catalog_name("N.O.V.A. 3"), "nova 3");
        assert_eq!(normalize_catalog_name("g.t.a. v"), "gta v");
    }

    #[test]
    fn search_tokens_handles_dotted_acronyms() {
        let (phrase, tok) = search_phrase_and_tokens("S.T.A.L.K.E.R.").expect("tokens");
        assert_eq!(phrase, "stalker");
        assert_eq!(tok, vec!["stalker"]);
    }

    #[test]
    fn escape_like_escapes_wildcards() {
        assert_eq!(escape_like_pattern("50%"), "50\\%");
    }
}
