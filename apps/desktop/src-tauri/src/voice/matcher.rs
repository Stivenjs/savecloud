use std::collections::HashSet;

use crate::config::models::{ConfiguredGame, GameLibrary};
use crate::steam_catalog::normalize::{normalize_catalog_name, search_phrase_and_tokens};

#[derive(Debug, Clone)]
pub struct GameMatchCandidate {
    pub game_id: String,
    pub name: String,
    pub score: f32,
}

const FILLERS: &[&str] = &[
    "por",
    "favor",
    "eh",
    "emm",
    "mmm",
    "mm",
    "um",
    "uh",
    "oye",
    "cloud",
    "savecloud",
    "abre",
    "abrir",
    "ejecuta",
    "lanza",
    "inicia",
    "juega",
    "open",
    "launch",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "de",
    "del",
    "al",
];

const PREFIX_COMMANDS: &[&str] = &[
    "abre ", "abrir ", "ejecuta ", "lanza ", "inicia ", "juega ", "open ", "launch ",
];

const SHORTCUT_EXPANSIONS: &[(&str, &str)] = &[
    ("gta", "grand theft auto"),
    ("rdr", "red dead redemption"),
    ("cod", "call of duty"),
    ("cs", "counter strike"),
];

fn strip_fillers(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|token| !FILLERS.contains(token))
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_target_from_command(text: &str) -> String {
    for prefix in PREFIX_COMMANDS {
        if let Some(rest) = text.strip_prefix(prefix) {
            return rest.trim().to_string();
        }
    }
    text.to_string()
}

fn tokenize(input: &str) -> HashSet<String> {
    input
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn jaccard(a: &str, b: &str) -> f32 {
    let sa = tokenize(a);
    let sb = tokenize(b);
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let intersection = sa.intersection(&sb).count() as f32;
    let union = sa.union(&sb).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn overlap_ratio(a: &str, b: &str) -> f32 {
    let sa = tokenize(a);
    let sb = tokenize(b);
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let intersection = sa.intersection(&sb).count() as f32;
    intersection / (sa.len().min(sb.len()) as f32)
}

fn roman_to_arabic(token: &str) -> Option<&'static str> {
    match token {
        "i" => Some("1"),
        "ii" => Some("2"),
        "iii" => Some("3"),
        "iv" => Some("4"),
        "v" => Some("5"),
        "vi" => Some("6"),
        "vii" => Some("7"),
        "viii" => Some("8"),
        _ => None,
    }
}

fn arabic_to_roman(token: &str) -> Option<&'static str> {
    match token {
        "1" => Some("i"),
        "2" => Some("ii"),
        "3" => Some("iii"),
        "4" => Some("iv"),
        "5" => Some("v"),
        "6" => Some("vi"),
        "7" => Some("vii"),
        "8" => Some("viii"),
        _ => None,
    }
}

fn swap_roman_arabic_variant(input: &str) -> Option<String> {
    let mut out = Vec::new();
    let mut changed = false;
    for token in input.split_whitespace() {
        if let Some(arabic) = roman_to_arabic(token) {
            out.push(arabic.to_string());
            changed = true;
        } else if let Some(roman) = arabic_to_roman(token) {
            out.push(roman.to_string());
            changed = true;
        } else {
            out.push(token.to_string());
        }
    }
    if changed {
        Some(out.join(" "))
    } else {
        None
    }
}

fn acronym_of(input: &str) -> Option<String> {
    let acronym: String = input
        .split_whitespace()
        .filter_map(|token| token.chars().next())
        .filter(|c| c.is_alphanumeric())
        .collect();
    let acronym = acronym.to_lowercase();
    if acronym.len() >= 2 {
        Some(acronym)
    } else {
        None
    }
}

fn expanded_shortcut_query(input: &str) -> Option<String> {
    let mut out_tokens: Vec<String> = Vec::new();
    let mut changed = false;
    for token in input.split_whitespace() {
        if let Some((_, expanded)) = SHORTCUT_EXPANSIONS.iter().find(|(k, _)| *k == token) {
            out_tokens.extend(expanded.split_whitespace().map(ToString::to_string));
            changed = true;
        } else {
            out_tokens.push(token.to_string());
        }
    }
    if changed {
        Some(out_tokens.join(" "))
    } else {
        None
    }
}

fn canonicalize_query(input: &str) -> String {
    let normalized = normalize_catalog_name(input);
    let stripped = strip_fillers(&extract_target_from_command(&normalized));
    normalize_catalog_name(&stripped)
}

fn build_query_aliases(query: &str) -> Vec<String> {
    let mut aliases = vec![query.to_string()];
    if let Some(swapped) = swap_roman_arabic_variant(query) {
        aliases.push(normalize_catalog_name(&swapped));
    }
    if let Some(expanded) = expanded_shortcut_query(query) {
        aliases.push(normalize_catalog_name(&expanded));
    }
    aliases.sort_unstable();
    aliases.dedup();
    aliases
}

fn build_game_aliases(game: &ConfiguredGame) -> Vec<String> {
    let mut aliases = vec![normalize_catalog_name(&game.id)];

    if let Some(label) = &game.edition_label {
        let combined = format!("{} {}", game.id, label);
        aliases.push(normalize_catalog_name(&combined));
    }

    if let Some(exes) = &game.executable_names {
        for exe in exes {
            aliases.push(normalize_catalog_name(exe));
        }
    }

    let base = normalize_catalog_name(&game.id)
        .replace("edition", "")
        .replace("remastered", "")
        .replace("definitive", "")
        .replace("game of the year", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if !base.is_empty() {
        aliases.push(base.clone());
        if let Some(swapped) = swap_roman_arabic_variant(&base) {
            aliases.push(normalize_catalog_name(&swapped));
        }
        if let Some(acr) = acronym_of(&base) {
            aliases.push(acr);
        }
    }

    aliases.retain(|a| !a.is_empty());
    aliases.sort_unstable();
    aliases.dedup();
    aliases
}

fn score_alias_pair(query: &str, candidate: &str) -> f32 {
    if query.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let jac = jaccard(query, candidate);
    let overlap = overlap_ratio(query, candidate);
    let contains = if candidate.contains(query) || query.contains(candidate) {
        1.0
    } else {
        0.0
    };
    let prefix = if candidate.starts_with(query) || query.starts_with(candidate) {
        1.0
    } else {
        0.0
    };
    ((jac * 0.40) + (overlap * 0.35) + (contains * 0.15) + (prefix * 0.10)).min(1.0)
}

pub fn find_best_match(text: &str, library: &GameLibrary) -> Option<GameMatchCandidate> {
    let target = canonicalize_query(text);
    if target.is_empty() {
        return None;
    }

    let query_aliases = build_query_aliases(&target);
    let mut best: Option<GameMatchCandidate> = None;
    let mut second_best_score = 0.0_f32;

    for game in &library.games {
        let candidate_aliases = build_game_aliases(game);
        let mut score = 0.0_f32;
        for q in &query_aliases {
            for candidate in &candidate_aliases {
                score = score.max(score_alias_pair(q, candidate));
            }
        }

        if best.as_ref().is_none_or(|m| score > m.score) {
            if let Some(current_best) = &best {
                second_best_score = current_best.score;
            }
            best = Some(GameMatchCandidate {
                game_id: game.id.clone(),
                name: game.id.clone(),
                score,
            });
        } else if score > second_best_score {
            second_best_score = score;
        }
    }

    best.filter(|m| {
        let has_valid_tokens = search_phrase_and_tokens(&target).is_some();
        has_valid_tokens && m.score >= 0.40 && (m.score - second_best_score) >= 0.06
    })
}
