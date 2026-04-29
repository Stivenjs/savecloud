use std::collections::{HashMap, HashSet};

use crate::config::models::{ConfiguredGame, GameLibrary};
use crate::steam_catalog::normalize::{normalize_catalog_name, search_phrase_and_tokens};
use crate::voice::number_normalizer::expand_numeric_variants;

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

const EDITION_WORDS: &[&str] = &["edition", "remastered", "definitive", "game of the year"];

const W_JACCARD: f32 = 0.40;
const W_OVERLAP: f32 = 0.35;
const W_CONTAINS: f32 = 0.15;
const W_PREFIX: f32 = 0.10;

const MIN_TOP_SCORE: f32 = 0.30;
const MIN_BEST_SCORE: f32 = 0.40;
const MIN_MARGIN: f32 = 0.06;

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
    let union = sa.union(&sb).count() as f32;
    if union == 0.0 {
        return 0.0;
    }
    sa.intersection(&sb).count() as f32 / union
}

fn overlap_ratio(a: &str, b: &str) -> f32 {
    let sa = tokenize(a);
    let sb = tokenize(b);
    let min = sa.len().min(sb.len()) as f32;
    if min == 0.0 {
        return 0.0;
    }
    sa.intersection(&sb).count() as f32 / min
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

fn swap_roman_arabic(input: &str) -> Option<String> {
    let mut changed = false;
    let result = input
        .split_whitespace()
        .map(|t| {
            if let Some(s) = roman_to_arabic(t).or_else(|| arabic_to_roman(t)) {
                changed = true;
                s.to_string()
            } else {
                t.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    changed.then_some(result)
}

fn acronym_of(input: &str) -> Option<String> {
    let acr: String = input
        .split_whitespace()
        .filter_map(|t| t.chars().next())
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    (acr.len() >= 2).then_some(acr)
}

fn compact_variant(input: &str) -> Option<String> {
    let compact: String = input.split_whitespace().collect();
    (compact.len() >= 4 && compact != input).then_some(compact)
}

fn expanded_shortcuts(input: &str) -> Option<String> {
    let map: HashMap<&str, &str> = SHORTCUT_EXPANSIONS.iter().copied().collect();

    let mut changed = false;
    let result = input
        .split_whitespace()
        .flat_map(|t| {
            if let Some(&expanded) = map.get(t) {
                changed = true;
                expanded.split_whitespace().collect::<Vec<_>>()
            } else {
                vec![t]
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    changed.then_some(result)
}

fn strip_fillers(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|t| !FILLERS.contains(t))
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_command_prefix(text: &str) -> &str {
    PREFIX_COMMANDS
        .iter()
        .find_map(|&prefix| text.strip_prefix(prefix))
        .map(str::trim)
        .unwrap_or(text)
}

fn strip_edition_words(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|t| !EDITION_WORDS.contains(t))
        .collect::<Vec<_>>()
        .join(" ")
}

fn canonicalize_query(input: &str) -> String {
    let normalized = normalize_catalog_name(input);
    let trimmed = strip_command_prefix(&normalized);
    let stripped = strip_fillers(trimmed);
    normalize_catalog_name(&stripped)
}

fn query_aliases(query: &str) -> Vec<String> {
    let canonical = canonicalize_query(query);
    let mut aliases = vec![canonical.clone()];

    if let Some(swapped) = swap_roman_arabic(&canonical) {
        aliases.push(normalize_catalog_name(&swapped));
    }
    if let Some(expanded) = expanded_shortcuts(&canonical) {
        aliases.push(normalize_catalog_name(&expanded));
    }
    for variant in expand_numeric_variants(&canonical) {
        aliases.push(normalize_catalog_name(&variant));
    }
    if let Some(compact) = compact_variant(&canonical) {
        aliases.push(compact);
    }

    aliases.sort_unstable();
    aliases.dedup();
    aliases
}

fn game_aliases(game: &ConfiguredGame) -> Vec<String> {
    let base_norm = normalize_catalog_name(&game.id);
    let mut aliases = vec![base_norm.clone()];

    if let Some(label) = &game.edition_label {
        aliases.push(normalize_catalog_name(&format!("{} {}", game.id, label)));
    }

    if let Some(exes) = &game.executable_names {
        aliases.extend(exes.iter().map(|e| normalize_catalog_name(e)));
    }

    let bare = strip_edition_words(&base_norm);
    if !bare.is_empty() {
        aliases.push(bare.clone());
        if let Some(compact) = compact_variant(&bare) {
            aliases.push(compact);
        }
        if let Some(swapped) = swap_roman_arabic(&bare) {
            aliases.push(normalize_catalog_name(&swapped));
        }
        if let Some(acr) = acronym_of(&bare) {
            aliases.push(acr);
        }
    }

    aliases.retain(|a| !a.is_empty());
    aliases.sort_unstable();
    aliases.dedup();
    aliases
}

fn score_pair(query: &str, candidate: &str) -> f32 {
    if query.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let contains = f32::from(candidate.contains(query) || query.contains(candidate));
    let prefix = f32::from(candidate.starts_with(query) || query.starts_with(candidate));

    (jaccard(query, candidate) * W_JACCARD
        + overlap_ratio(query, candidate) * W_OVERLAP
        + contains * W_CONTAINS
        + prefix * W_PREFIX)
        .min(1.0)
}

fn score_library(text: &str, library: &GameLibrary) -> Vec<GameMatchCandidate> {
    let target = canonicalize_query(text);
    if target.is_empty() {
        return Vec::new();
    }

    let q_aliases = query_aliases(text); // uses raw text so canonicalize runs inside

    library
        .games
        .iter()
        .map(|game| {
            let g_aliases = game_aliases(game);
            let score = q_aliases
                .iter()
                .flat_map(|q| g_aliases.iter().map(move |g| score_pair(q, g)))
                .fold(0.0_f32, f32::max);

            GameMatchCandidate {
                game_id: game.id.clone(),
                name: game.id.clone(),
                score,
            }
        })
        .collect::<Vec<_>>()
        .tap_mut(|v| v.sort_by(|a, b| b.score.total_cmp(&a.score)))
}

pub fn find_top_matches(
    text: &str,
    library: &GameLibrary,
    limit: usize,
) -> Vec<GameMatchCandidate> {
    if limit == 0 {
        return Vec::new();
    }
    score_library(text, library)
        .into_iter()
        .filter(|m| m.score >= MIN_TOP_SCORE)
        .take(limit)
        .collect()
}

pub fn find_best_match(text: &str, library: &GameLibrary) -> Option<GameMatchCandidate> {
    let target = canonicalize_query(text);
    if search_phrase_and_tokens(&target).is_none() {
        return None;
    }

    let mut scored = score_library(text, library);
    let best = scored.first()?;
    let second_score = scored.get(1).map_or(0.0, |m| m.score);

    (best.score >= MIN_BEST_SCORE && (best.score - second_score) >= MIN_MARGIN)
        .then(|| scored.remove(0))
}

trait TapMut: Sized {
    fn tap_mut(mut self, f: impl FnOnce(&mut Self)) -> Self {
        f(&mut self);
        self
    }
}
impl<T> TapMut for Vec<T> {}

#[cfg(test)]
mod tests {
    use super::{find_best_match, find_top_matches, query_aliases};
    use crate::config::models::{ConfiguredGame, GameLibrary};

    fn game(id: &str) -> ConfiguredGame {
        ConfiguredGame {
            id: id.to_string(),
            paths: Vec::new(),
            steam_app_id: None,
            image_url: None,
            executable_names: None,
            edition_label: None,
            source_url: None,
            magnet_link: None,
            launch_executable_path: None,
            playtime_seconds: 0,
        }
    }

    fn library(ids: &[&str]) -> GameLibrary {
        GameLibrary {
            games: ids.iter().map(|&id| game(id)).collect(),
        }
    }

    #[test]
    fn query_aliases_includes_numeric_variant_for_spoken_number() {
        let aliases = query_aliases("resident evil cuatro");
        assert!(aliases.contains(&"resident evil 4".to_string()));
    }

    #[test]
    fn query_aliases_includes_numeric_variant_for_compound_number() {
        let aliases = query_aliases("fifa treinta y dos");
        assert!(aliases.contains(&"fifa 32".to_string()));
    }

    #[test]
    fn top_matches_ranks_spoken_number_correctly() {
        let lib = library(&["resident evil 4", "resident evil 2"]);
        let candidates = find_top_matches("resident evil cuatro", &lib, 2);
        assert_eq!(
            candidates.first().map(|c| c.game_id.as_str()),
            Some("resident evil 4")
        );
    }

    #[test]
    fn top_matches_handles_compact_game_ids() {
        let lib = library(&["eldenring", "sekiro"]);
        let candidates = find_top_matches("elden ring", &lib, 2);
        assert_eq!(
            candidates.first().map(|c| c.game_id.as_str()),
            Some("eldenring")
        );
    }

    #[test]
    fn best_match_returns_none_for_empty_query() {
        let lib = library(&["doom eternal"]);
        assert!(find_best_match("", &lib).is_none());
    }
}
