//! Motor de coincidencia de alta precisión y rendimiento para fuentes de descarga.
//!
//! Implementa normalización heurística de títulos, eliminación de ruido de versiones y grupos
//! de la escena (repacks), detección de acrónimos y un índice invertido en memoria basado en
//! hashes FNV-1a para resolución en tiempo constante `O(1)`.

use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

static RE_TRAILING_RELEASE_NOISE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\s*[-–—,]\s*(?:v\.?\d+|build\b|patch\b|update\b|\+\s*\d+|\+?\s*all\s+dlc).*$")
        .unwrap()
});

static RE_VERSION_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:v|ver|version)\.?\s*\d+[a-z0-9._-]*\b").unwrap());

static RE_BUILD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bbuild\s*[-_]?\s*\d+\b").unwrap());

static RE_DLC_BONUS_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\+\s*\d*\s*(?:dlcs?|bonuses?|bonus|ost|soundtrack|fix|multi\d*|online|emu[a-z]*)\b.*",
    )
    .unwrap()
});

/// Configuración global de umbrales y palabras vacías para el motor de coincidencia.
#[derive(Debug, Clone)]
pub struct MatchConfig {
    /// Umbral mínimo de similitud requerido para aceptar a un candidato.
    pub threshold: f32,
    /// Hashes FNV-1a ordenados de las palabras que se ignoran durante la tokenización.
    pub stopwords: Vec<u64>,
}

/// Registro estructurado de un item de catálogo procesado para búsqueda rápida en memoria.
#[derive(Debug, Clone)]
pub struct IndexEntry {
    /// Identificador único de la fuente a la que pertenece el item.
    pub source_id: String,
    /// Nombre visible del proveedor o fuente.
    pub source_name: String,
    /// Identificador único del juego dentro del catálogo.
    pub item_id: String,
    /// Título original sin procesar.
    pub item_title: String,
    /// Título canónico normalizado.
    pub normalized_title: String,
    /// Variaciones y alias limpios extraídos del título.
    pub clean_aliases: Vec<String>,
    /// Hashes FNV-1a únicos y ordenados de los tokens del título.
    pub token_hashes: Vec<u64>,
    /// Protocolos de descarga soportados por el item.
    pub protocols: Vec<crate::sources::domain::DownloadProtocol>,
    /// Tamaño legible del archivo descargable.
    pub file_size: Option<String>,
    /// Enlaces URI disponibles para descarga.
    pub uris: Vec<crate::sources::domain::SourceUri>,
}

/// Índice invertido en memoria para búsqueda acelerada en tiempo sub-milisegundo.
#[derive(Debug, Clone, Default)]
pub struct MatchIndex {
    /// Vector de todas las entradas indexadas.
    pub entries: Vec<IndexEntry>,
    /// Mapeo de hash de token a los índices posicionales dentro de `entries`.
    pub token_to_entries: HashMap<u64, Vec<usize>>,
}

impl MatchIndex {
    /// Construye una nueva instancia de [`MatchIndex`] generando el índice invertido por tokens.
    ///
    /// # Arguments
    ///
    /// * `entries` - Colección plana de elementos de fuentes de catálogo.
    ///
    /// # Returns
    ///
    /// Estructura [`MatchIndex`] lista para consultas en memoria `O(1)`.
    pub fn build(entries: Vec<IndexEntry>) -> Self {
        let mut token_to_entries: HashMap<u64, Vec<usize>> = HashMap::new();
        for (idx, entry) in entries.iter().enumerate() {
            for &token in &entry.token_hashes {
                token_to_entries.entry(token).or_default().push(idx);
            }
        }
        Self {
            entries,
            token_to_entries,
        }
    }

    /// Indica si el índice no contiene ningún registro.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Representación del mejor resultado de coincidencia por cada fuente de catálogo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceBestMatch {
    /// Identificador de la fuente proveedora.
    pub source_id: String,
    /// Nombre visible de la fuente.
    pub source_name: String,
    /// Identificador del item coincidente.
    pub item_id: String,
    /// Título original del item coincidente.
    pub item_title: String,
    /// Puntuación final de coincidencia asignada.
    pub score: f32,
    /// Protocolos de descarga soportados por el item.
    pub protocols: Vec<crate::sources::domain::DownloadProtocol>,
    /// Tamaño formateado del archivo.
    pub file_size: Option<String>,
    /// Enlaces URI de descarga asociados.
    pub uris: Vec<crate::sources::domain::SourceUri>,
}

/// Calcula el hash FNV-1a de 64 bits para una cadena de texto.
///
/// # Arguments
///
/// * `s` - Cadena a procesar.
///
/// # Returns
///
/// Entero `u64` con el hash calculado.
#[inline]
pub fn fnv1a(s: &str) -> u64 {
    const OFFSET: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    let mut hash = OFFSET;
    for byte in s.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Convierte números romanos comunes (del 1 al 20) a sus dígitos arábigos en formato string.
///
/// # Arguments
///
/// * `token` - Palabra candidata en minúsculas.
///
/// # Returns
///
/// `Some(&'static str)` con el número en dígitos si es un número romano válido, o `None`.
pub fn convert_roman_numeral(token: &str) -> Option<&'static str> {
    match token {
        "i" => Some("1"),
        "ii" => Some("2"),
        "iii" => Some("3"),
        "iv" => Some("4"),
        "v" => Some("5"),
        "vi" => Some("6"),
        "vii" => Some("7"),
        "viii" => Some("8"),
        "ix" => Some("9"),
        "x" => Some("10"),
        "xi" => Some("11"),
        "xii" => Some("12"),
        "xiii" => Some("13"),
        "xiv" => Some("14"),
        "xv" => Some("15"),
        "xvi" => Some("16"),
        "xvii" => Some("17"),
        "xviii" => Some("18"),
        "xix" => Some("19"),
        "xx" => Some("20"),
        _ => None,
    }
}

/// Elimina corchetes, paréntesis y metadatos de versiones, repacks e idiomas de la escena.
///
/// # Arguments
///
/// * `raw` - Título original del juego o item de la fuente.
///
/// # Returns
///
/// Cadena limpia de ruido de empaquetado y etiquetas de grupo.
pub fn strip_brackets_and_scene_noise(raw: &str) -> String {
    let mut result = String::with_capacity(raw.len());
    let mut depth = 0usize;
    let mut in_bracket_content = String::new();

    for ch in raw.chars() {
        match ch {
            '[' | '(' | '{' => {
                depth += 1;
                in_bracket_content.clear();
            }
            ']' | ')' | '}' => {
                depth = depth.saturating_sub(1);
            }
            c => {
                if depth == 0 {
                    result.push(c);
                } else {
                    in_bracket_content.push(c);
                }
            }
        }
    }

    let trimmed = result.trim();
    let base = if trimmed.is_empty() && !in_bracket_content.is_empty() {
        in_bracket_content
    } else {
        trimmed.to_string()
    };

    let no_trailing = RE_TRAILING_RELEASE_NOISE.replace(&base, "");
    let no_versions = RE_VERSION_PATTERN.replace_all(&no_trailing, " ");
    let no_builds = RE_BUILD_PATTERN.replace_all(&no_versions, " ");
    let no_dlc = RE_DLC_BONUS_PATTERN.replace_all(&no_builds, " ");

    no_dlc.trim().to_string()
}

/// Elimina sufijos de ediciones estándar comerciales (ej. "Deluxe Edition", "GOTY", "Remastered").
///
/// # Arguments
///
/// * `input` - Cadena de texto de entrada.
///
/// # Returns
///
/// Cadena en minúsculas sin las etiquetas de edición comercial.
pub fn strip_edition_tags(input: &str) -> String {
    let lowercase = input.to_lowercase();
    let edition_patterns = [
        "premium deluxe edition",
        "digital deluxe edition",
        "game of the year edition",
        "game of the year",
        "goty edition",
        "goty",
        "deluxe edition",
        "ultimate edition",
        "complete edition",
        "complete collection",
        "directors cut",
        "director s cut",
        "definitive edition",
        "anniversary edition",
        "enhanced edition",
        "special edition",
        "standard edition",
        "collector s edition",
        "collectors edition",
        "collector edition",
        "remastered edition",
        "remastered",
        "hd remaster",
        "premium edition",
        "legacy edition",
        "gold edition",
        "day one edition",
        "bonus content",
        "all dlcs",
        "next gen update",
        "free download",
    ];

    let mut clean = lowercase;
    for pattern in edition_patterns {
        clean = clean.replace(pattern, " ");
    }
    clean
}

/// Normaliza un título para comparaciones consistentes.
///
/// Limpia corchetes, remueve etiquetas de edición, traduce números romanos a arábigos,
/// sustituye caracteres no alfanuméricos por espacios y comprime espacios redundantes.
///
/// # Arguments
///
/// * `input` - Título original a normalizar.
///
/// # Returns
///
/// Cadena canónica normalizada en minúsculas.
pub fn normalize_title(input: &str) -> String {
    let no_brackets = strip_brackets_and_scene_noise(input);
    let no_editions = strip_edition_tags(&no_brackets);

    let mut out = String::with_capacity(no_editions.len());
    let mut last_space = false;

    for ch in no_editions.chars() {
        let ch_lower = ch.to_ascii_lowercase();
        if ch_lower.is_alphanumeric() {
            out.push(ch_lower);
            last_space = false;
        } else if ch_lower == '&' {
            if !last_space {
                out.push(' ');
            }
            out.push_str("and ");
            last_space = true;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }

    out.split_whitespace()
        .map(|token| convert_roman_numeral(token).unwrap_or(token))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extrae alias limpios de títulos que combinan nombres alternativos con separadores `/` o `|`.
///
/// # Arguments
///
/// * `raw` - Título original del item.
///
/// # Returns
///
/// Vector con los alias normalizados individuales y la forma compuesta completa.
pub fn extract_title_aliases(raw: &str) -> Vec<String> {
    let no_brackets = strip_brackets_and_scene_noise(raw);
    let mut aliases = Vec::new();

    let parts: Vec<&str> = no_brackets
        .split(['/', '|'])
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if parts.len() > 1 {
        for part in parts {
            let norm = normalize_title(part);
            if !norm.is_empty() && !aliases.contains(&norm) {
                aliases.push(norm);
            }
        }
    }

    let full_norm = normalize_title(raw);
    if !full_norm.is_empty() && !aliases.contains(&full_norm) {
        aliases.push(full_norm);
    }

    aliases
}

/// Genera una secuencia ordenada y deduplicada de hashes FNV-1a excluyendo stopwords.
///
/// # Arguments
///
/// * `normalized` - Cadena normalizada.
/// * `stopwords` - Hashes ordenados de palabras a omitir.
///
/// # Returns
///
/// Vector de hashes `u64`.
pub fn tokenize_sorted_filtered(normalized: &str, stopwords: &[u64]) -> Vec<u64> {
    let mut hashes: Vec<u64> = normalized
        .split_whitespace()
        .map(fnv1a)
        .filter(|h| stopwords.binary_search(h).is_err())
        .collect();
    hashes.sort_unstable();
    hashes.dedup();
    hashes
}

/// Extrae el primer número de secuela (<= 99) o año de lanzamiento (1970..=2099) presente en el título.
///
/// # Arguments
///
/// * `normalized` - Título normalizado a inspeccionar.
///
/// # Returns
///
/// `Some(u32)` si se localiza un número o año válido, o `None`.
pub fn extract_sequel_number(normalized: &str) -> Option<u32> {
    normalized.split_whitespace().find_map(|t| {
        if t.starts_with('0') && t.len() > 1 {
            return None;
        }
        t.parse::<u32>()
            .ok()
            .filter(|&n| (1..=99).contains(&n) || (1970..=2099).contains(&n))
    })
}

/// Comprueba si las letras iniciales de los tokens forman el acrónimo buscado.
fn matches_acronym_slice(acronym: &str, target_tokens: &[&str]) -> bool {
    if target_tokens.len() < 2 || acronym.len() != target_tokens.len() {
        return false;
    }

    let mut initials = String::with_capacity(target_tokens.len());
    for t in target_tokens {
        if let Some(first_char) = t.chars().next() {
            initials.push(first_char);
        }
    }

    initials.eq_ignore_ascii_case(acronym)
}

/// Evalúa la similitud entre la consulta y un candidato con cero asignaciones en memoria heap.
///
/// Aplica discriminación de secuelas, concordancia de acrónimos, recall de tokens y penalización
/// por palabras residuales o spin-offs no solicitados.
///
/// # Arguments
///
/// * `query_norm` - Título normalizado de la consulta.
/// * `q_tokens` - Tokens de la consulta precalculados en slice.
/// * `q_num` - Número de secuela extraído de la consulta.
/// * `candidate_aliases` - Lista de alias limpios del candidato.
/// * `candidate_norm` - Título normalizado principal del candidato.
///
/// # Returns
///
/// Puntuación flotante entre `0.0` y `1.0`.
#[inline]
pub fn calculate_match_score_fast(
    query_norm: &str,
    q_tokens: &[&str],
    q_num: Option<u32>,
    candidate_aliases: &[String],
    candidate_norm: &str,
) -> f32 {
    if query_norm.is_empty() {
        return 0.0;
    }

    let mut best_score = 0.0f32;

    let eval_alias = |cand: &str, best_score: &mut f32| {
        if cand.is_empty() {
            return;
        }

        if query_norm == cand {
            *best_score = 1.0;
            return;
        }

        let c_num = extract_sequel_number(cand);

        if let (Some(qn), Some(cn)) = (q_num, c_num) {
            if qn != cn {
                return;
            }
        }

        let mut c_tokens_buf = [""; 16];
        let mut c_len = 0;
        for token in cand.split_whitespace() {
            if c_len < c_tokens_buf.len() {
                c_tokens_buf[c_len] = token;
                c_len += 1;
            }
        }
        let c_tokens = &c_tokens_buf[..c_len];

        if c_tokens.is_empty() || q_tokens.is_empty() {
            return;
        }

        if q_tokens.len() == 2 && c_tokens.len() >= 3 {
            let acronym_part = q_tokens[0];
            let rest_cand = &c_tokens[..c_tokens.len() - 1];
            if matches_acronym_slice(acronym_part, rest_cand)
                && q_tokens[1] == c_tokens[c_tokens.len() - 1]
            {
                *best_score = best_score.max(0.96);
                return;
            }
        }

        let mut common_count = 0usize;
        for qt in q_tokens {
            if c_tokens.contains(qt) {
                common_count += 1;
            }
        }

        if common_count == 0 {
            return;
        }

        let query_recall = common_count as f32 / q_tokens.len() as f32;
        let cand_precision = common_count as f32 / c_tokens.len() as f32;

        let mut score: f32;

        if query_recall >= 0.99 {
            let extra_tokens = c_tokens.len().saturating_sub(q_tokens.len());
            let extra_penalty = (extra_tokens as f32 * 0.08).min(0.35);
            score = 0.95 - extra_penalty;

            let mut seq_match = true;
            let mut last_idx = None;
            for qt in q_tokens {
                if let Some(pos) = c_tokens.iter().position(|t| t == qt) {
                    if let Some(prev) = last_idx {
                        if pos <= prev {
                            seq_match = false;
                            break;
                        }
                    }
                    last_idx = Some(pos);
                }
            }
            if seq_match {
                score += 0.04;
            }
        } else {
            let dice = (2.0 * common_count as f32) / (q_tokens.len() + c_tokens.len()) as f32;
            score = dice * (0.6 * query_recall + 0.4 * cand_precision);
        }

        match (q_num, c_num) {
            (None, Some(_)) => {
                score -= 0.40;
            }
            (Some(_), None) => {
                score -= 0.40;
            }
            (Some(qn), Some(cn)) if qn == cn => {
                score = (score + 0.05).min(1.0);
            }
            _ => {}
        }

        *best_score = best_score.max(score.clamp(0.0, 1.0));
    };

    if candidate_aliases.is_empty() {
        eval_alias(candidate_norm, &mut best_score);
    } else {
        for alias in candidate_aliases {
            eval_alias(alias, &mut best_score);
            if best_score >= 0.99 {
                break;
            }
        }
    }

    best_score
}

/// Orquesta la búsqueda y selecciona el mejor candidato representativo por cada catálogo.
///
/// Utiliza el índice invertido de [`MatchIndex`] para filtrar instantáneamente los candidatos
/// antes de la evaluación detallada de similitud.
///
/// # Arguments
///
/// * `_game_name` - Nombre original de búsqueda provisto por el usuario.
/// * `normalized_game` - Nombre de búsqueda normalizado.
/// * `game_hashes` - Hashes FNV-1a de las palabras clave de la consulta.
/// * `config` - Configuración de umbral y stopwords.
/// * `index` - Referencia al índice en memoria.
///
/// # Returns
///
/// Vector de [`SourceBestMatch`] ordenado de forma descendente por score.
pub fn find_best_per_source(
    _game_name: &str,
    normalized_game: &str,
    game_hashes: &[u64],
    config: &MatchConfig,
    index: &MatchIndex,
) -> Vec<SourceBestMatch> {
    if normalized_game.is_empty() || index.is_empty() {
        return Vec::new();
    }

    let mut candidate_lists: Vec<&Vec<usize>> = Vec::with_capacity(game_hashes.len());
    for &h in game_hashes {
        if let Some(list) = index.token_to_entries.get(&h) {
            candidate_lists.push(list);
        }
    }

    if candidate_lists.is_empty() {
        return Vec::new();
    }

    candidate_lists.sort_unstable_by_key(|l| l.len());

    let mut candidate_indices: Vec<usize> = Vec::with_capacity(256);
    if candidate_lists.len() > 1 && candidate_lists[0].len() <= 600 {
        candidate_indices.extend_from_slice(candidate_lists[0]);
        if candidate_lists.len() > 1 && candidate_lists[1].len() <= 600 {
            candidate_indices.extend_from_slice(candidate_lists[1]);
        }
    } else {
        for list in candidate_lists {
            candidate_indices.extend_from_slice(list);
        }
    }

    candidate_indices.sort_unstable();
    candidate_indices.dedup();

    let q_num = extract_sequel_number(normalized_game);
    let q_tokens: Vec<&str> = normalized_game.split_whitespace().collect();

    let mut by_source: HashMap<&str, (&IndexEntry, f32)> = HashMap::with_capacity(16);

    for idx in candidate_indices {
        let entry = &index.entries[idx];
        let score = calculate_match_score_fast(
            normalized_game,
            &q_tokens,
            q_num,
            &entry.clean_aliases,
            &entry.normalized_title,
        );

        if score >= config.threshold {
            by_source
                .entry(&entry.source_id)
                .and_modify(|(best_entry, best_score)| {
                    if score > *best_score
                        || ((score - *best_score).abs() < f32::EPSILON
                            && entry.item_title.len() < best_entry.item_title.len())
                    {
                        *best_entry = entry;
                        *best_score = score;
                    }
                })
                .or_insert((entry, score));
        }
    }

    let mut results: Vec<SourceBestMatch> = by_source
        .into_values()
        .map(|(winner, score)| SourceBestMatch {
            source_id: winner.source_id.clone(),
            source_name: winner.source_name.clone(),
            item_id: winner.item_id.clone(),
            item_title: winner.item_title.clone(),
            score,
            protocols: winner.protocols.clone(),
            file_size: winner.file_size.clone(),
            uris: winner.uris.clone(),
        })
        .collect();

    results.sort_unstable_by(|a, b| b.score.total_cmp(&a.score));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inverted_index_fast_search() {
        let entry1 = IndexEntry {
            source_id: "fitgirl".to_string(),
            source_name: "FitGirl".to_string(),
            item_id: "1".to_string(),
            item_title: "Cyberpunk 2077 [FitGirl Repack]".to_string(),
            normalized_title: "cyberpunk 2077".to_string(),
            clean_aliases: vec!["cyberpunk 2077".to_string()],
            token_hashes: tokenize_sorted_filtered("cyberpunk 2077", &[]),
            protocols: vec![],
            file_size: None,
            uris: vec![],
        };

        let entry2 = IndexEntry {
            source_id: "fitgirl".to_string(),
            source_name: "FitGirl".to_string(),
            item_id: "2".to_string(),
            item_title: "Hades II [FitGirl Repack]".to_string(),
            normalized_title: "hades 2".to_string(),
            clean_aliases: vec!["hades 2".to_string()],
            token_hashes: tokenize_sorted_filtered("hades 2", &[]),
            protocols: vec![],
            file_size: None,
            uris: vec![],
        };

        let index = MatchIndex::build(vec![entry1, entry2]);
        let config = MatchConfig {
            threshold: 0.60,
            stopwords: vec![],
        };

        let norm_query = normalize_title("Cyberpunk 2077");
        let hashes = tokenize_sorted_filtered(&norm_query, &[]);
        let results = find_best_per_source("Cyberpunk 2077", &norm_query, &hashes, &config, &index);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].item_title, "Cyberpunk 2077 [FitGirl Repack]");
        assert_eq!(results[0].score, 1.0);
    }

    #[test]
    fn test_monster_hunter_wilds_fitgirl_and_dodi_match() {
        let fitgirl_title =
            "Monster Hunter Wilds: Premium Deluxe Edition – v1.041.03.00 + 191 DLCs/Bonuses";
        let dodi_title = "Monster Hunter Wilds: Premium Deluxe Edition (Build 22195748 + All DLCs + High Resolution Textures Pack + MULTi15) (From 77.7 GB) (Hypervisor) [DODI / DenuvOwO Repack]";

        let norm_fitgirl = normalize_title(fitgirl_title);
        let norm_dodi = normalize_title(dodi_title);

        assert_eq!(norm_fitgirl, "monster hunter wilds");
        assert_eq!(norm_dodi, "monster hunter wilds");

        let entry_fitgirl = IndexEntry {
            source_id: "fitgirl".to_string(),
            source_name: "FitGirl".to_string(),
            item_id: "fg-1".to_string(),
            item_title: fitgirl_title.to_string(),
            normalized_title: norm_fitgirl.clone(),
            clean_aliases: vec![norm_fitgirl.clone()],
            token_hashes: tokenize_sorted_filtered(&norm_fitgirl, &[]),
            protocols: vec![],
            file_size: Some("61.1 GB".to_string()),
            uris: vec![],
        };

        let entry_dodi = IndexEntry {
            source_id: "dodi".to_string(),
            source_name: "DODI".to_string(),
            item_id: "dodi-1".to_string(),
            item_title: dodi_title.to_string(),
            normalized_title: norm_dodi.clone(),
            clean_aliases: vec![norm_dodi.clone()],
            token_hashes: tokenize_sorted_filtered(&norm_dodi, &[]),
            protocols: vec![],
            file_size: Some("99.7 GB".to_string()),
            uris: vec![],
        };

        let index = MatchIndex::build(vec![entry_fitgirl, entry_dodi]);
        let config = MatchConfig {
            threshold: 0.60,
            stopwords: vec![],
        };

        let norm_query = normalize_title("Monster Hunter Wilds");
        let hashes = tokenize_sorted_filtered(&norm_query, &[]);
        let results = find_best_per_source(
            "Monster Hunter Wilds",
            &norm_query,
            &hashes,
            &config,
            &index,
        );

        assert_eq!(
            results.len(),
            2,
            "Both FitGirl and DODI should match Monster Hunter Wilds"
        );
        for r in &results {
            assert!(
                r.score >= 0.90,
                "Score should be >= 0.90 for both, got {}",
                r.score
            );
        }
    }
}
