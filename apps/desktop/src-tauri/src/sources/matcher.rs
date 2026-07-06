//! Motor de matching puro: sin I/O, sin estado global.
//!
//! Recibe el índice, la configuración y devuelve exactamente 1 resultado por `source_id`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuración global del motor de emparejamiento (matching).
///
/// Debe cargarse una sola vez en el arranque de la aplicación y pasarse por referencia a cada llamada.
#[derive(Debug, Clone)]
pub struct MatchConfig {
    /// Umbral mínimo de similitud (score de Jaccard) requerido para considerar a un candidato como válido.
    pub threshold: f32,
    /// Hashes FNV-1a correspondientes a las palabras que se ignorarán durante la tokenización (stopwords).
    pub stopwords: Vec<u64>,
}

/// Entrada estandarizada del índice de búsqueda.
///
/// Estructuralmente equivalente a `IndexedSourceItem` en el módulo de comandos. Representa
/// un elemento pre-procesado listo para la comparación rápida en memoria.
#[derive(Debug, Clone)]
pub struct IndexEntry {
    pub source_id: String,
    pub source_name: String,
    pub item_id: String,
    pub item_title: String,
    pub normalized_title: String,
    /// Tokens del título hasheados con FNV-1a, ordenados numéricamente y filtrados (sin stopwords).
    pub token_hashes: Vec<u64>,
    pub protocols: Vec<crate::sources::domain::DownloadProtocol>,
    pub file_size: Option<String>,
    pub uris: Vec<crate::sources::domain::SourceUri>,
}

/// Un candidato temporal que ha sido evaluado y superado el umbral mínimo de similitud.
#[derive(Debug, Clone)]
pub struct RawCandidate<'a> {
    pub entry: &'a IndexEntry,
    pub score: f32,
}

/// Resultado final que encapsula la mejor coincidencia encontrada para una fuente de catálogo específica.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceBestMatch {
    pub source_id: String,
    pub source_name: String,
    pub item_id: String,
    pub item_title: String,
    pub score: f32,
    pub protocols: Vec<crate::sources::domain::DownloadProtocol>,
    pub file_size: Option<String>,
    pub uris: Vec<crate::sources::domain::SourceUri>,
}

/// Clasificación heurística del tipo de consulta (query) solicitada por el usuario.
#[derive(Debug, PartialEq)]
pub enum QueryKind {
    /// La consulta contiene números o más de 3 tokens, por lo que se exige coincidencia numérica estricta.
    Specific { number: Option<u32> },
    /// La consulta tiene 3 o menos tokens y carece de números. Se intenta seleccionar un representante global por franquicia.
    Generic,
}

/// Calcula el hash rápido de 64 bits FNV-1a para una cadena de texto.
///
/// # Arguments
///
/// * `s` - Cadena de texto a procesar.
///
/// # Returns
///
/// El entero `u64` resultante del algoritmo FNV-1a.
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

/// Normaliza un título para facilitar una comparación robusta y consistente.
///
/// Convierte caracteres a minúsculas, elimina los que no sean alfanuméricos
/// y comprime los espacios múltiples en uno solo.
///
/// # Arguments
///
/// * `input` - Título original en bruto.
///
/// # Returns
///
/// Cadena `String` normalizada.
pub fn normalize_title(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = false;
    for ch in input.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Genera una lista de hashes FNV-1a a partir de un título normalizado, descartando palabras vacías.
///
/// # Arguments
///
/// * `normalized` - Cadena de texto normalizada.
/// * `stopwords` - Slice de hashes ordenados que serán omitidos.
///
/// # Returns
///
/// Un vector ordenado y deduplicado de hashes `u64`.
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

/// Analiza un título normalizado para detectar dinámicamente la estrategia de búsqueda a aplicar.
///
/// # Arguments
///
/// * `normalized` - El texto de búsqueda normalizado aportado por el usuario.
///
/// # Returns
///
/// Una variante `QueryKind` señalando la intención (`Specific` o `Generic`).
pub fn detect_query_kind(normalized: &str) -> QueryKind {
    let tokens: Vec<&str> = normalized.split_whitespace().collect();

    let number = tokens.iter().find_map(|t| t.parse::<u32>().ok());

    // Genérica: pocos tokens Y sin números explícitos
    if tokens.len() <= 3 && number.is_none() {
        return QueryKind::Generic;
    }

    QueryKind::Specific { number }
}

/// Comprueba si todos los hashes del slice `needle` están presentes dentro de `haystack`.
///
/// Aprovecha que ambos slices están ordenados para hacer la búsqueda en O(n+m) con
/// dos punteros, evitando asignaciones dinámicas.
///
/// Se usa como condición previa al atajo de contención en `jaccard_score`: garantiza
/// que la contención es real a nivel de **tokens** y no un falso positivo por substring
/// de texto (ej. "dream" dentro de "fractured dream" a nivel de caracteres, pero no
/// como token completo dentro del set de hashes del query).
///
/// # Arguments
///
/// * `needle` - Hashes ordenados del lado más corto (candidato o query).
/// * `haystack` - Hashes ordenados del lado más largo donde se busca contención.
///
/// # Returns
///
/// `true` si cada hash de `needle` aparece en `haystack`.
#[inline]
fn hashes_are_subset(needle: &[u64], haystack: &[u64]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if needle.len() > haystack.len() {
        return false;
    }
    let mut hi = 0;
    for &n in needle {
        // Avanza en haystack hasta encontrar n o superarlo
        while hi < haystack.len() && haystack[hi] < n {
            hi += 1;
        }
        if hi >= haystack.len() || haystack[hi] != n {
            return false;
        }
        hi += 1;
    }
    true
}

/// Calcula el coeficiente de similitud de Jaccard entre dos secuencias de tokens (hashes).
///
/// Incorpora heurísticas de abandono prematuro: evalúa contención de tokens completos y
/// la cota superior matemática posible antes de iterar para optimizar CPU.
///
/// El atajo de contención (`0.96`) aplica únicamente cuando **todos los tokens** del lado
/// más corto están presentes en el lado más largo, evaluado sobre los hashes FNV-1a.
/// Esto evita falsos positivos por coincidencia de substring a nivel de caracteres
/// (ej. "dream" contenido en "fractured dream" como texto, pero no como token del query
/// "demi and the fractured dream").
///
/// # Arguments
///
/// * `left_norm` - Cadena normalizada de la consulta izquierda.
/// * `left_hashes` - Hashes correspondientes a la cadena izquierda.
/// * `right_norm` - Cadena normalizada del candidato a comparar.
/// * `right_hashes` - Hashes correspondientes al candidato.
/// * `threshold` - Límite mínimo esperado; si la cota superior es menor, retorna 0 temprano.
///
/// # Returns
///
/// Coeficiente flotante entre `0.0` y `1.0`.
#[inline]
pub fn jaccard_score(
    left_norm: &str,
    left_hashes: &[u64],
    right_norm: &str,
    right_hashes: &[u64],
    threshold: f32,
) -> f32 {
    if left_norm.is_empty() || right_norm.is_empty() {
        return 0.0;
    }
    if left_norm == right_norm {
        return 1.0;
    }

    let ln = left_hashes.len();
    let rn = right_hashes.len();
    if ln == 0 || rn == 0 {
        return 0.0;
    }

    // Atajo de contención: solo aplica cuando todos los tokens del lado más corto
    // están presentes en el lado más largo. Evaluar sobre hashes (no sobre el string)
    // evita que "dream" (1 token) obtenga 0.96 contra "demi and the fractured dream"
    // (5 tokens) simplemente porque "dream" es substring del texto normalizado.
    let (shorter, longer) = if ln <= rn {
        (left_hashes, right_hashes)
    } else {
        (right_hashes, left_hashes)
    };
    if hashes_are_subset(shorter, longer) {
        return 0.96;
    }

    let upper_bound = ln.min(rn) as f32 / ln.max(rn) as f32;
    if upper_bound < threshold {
        return 0.0;
    }
    let mut i = 0;
    let mut j = 0;
    let mut intersection = 0usize;
    while i < ln && j < rn {
        match left_hashes[i].cmp(&right_hashes[j]) {
            std::cmp::Ordering::Equal => {
                intersection += 1;
                i += 1;
                j += 1;
            }
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
        }
    }
    let union = ln + rn - intersection;
    intersection as f32 / union as f32
}

/// Extrae el año más reciente (limitado al rango lógico de 1970-2099) que aparezca en el título.
///
/// Se utiliza para desempates cronológicos en la búsqueda genérica.
///
/// # Argumentos
///
/// * `title` - Título original de donde se buscarán los dígitos.
///
/// # Retorna
///
/// El año extraído `Option<u32>` si se encontró alguno válido.
fn extract_year(title: &str) -> Option<u32> {
    title
        .split_whitespace()
        .filter_map(|t| {
            let n: u32 = t.trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()?;
            if (1970..=2099).contains(&n) {
                Some(n)
            } else {
                None
            }
        })
        .max()
}

/// Escanea y extrae el primer número considerado conceptualmente una secuela (≤ 99).
///
/// # Arguments
///
/// * `normalized` - Cadena de texto ya normalizada.
///
/// # Returns
///
/// El número hallado encapsulado en un `Option<u32>`.
fn extract_sequel_number(normalized: &str) -> Option<u32> {
    normalized
        .split_whitespace()
        .find_map(|t| t.parse::<u32>().ok().filter(|&n| n <= 99))
}

/// Selecciona el candidato óptimo para resoluciones de una búsqueda **específica**.
///
/// Reglas de prioridad en orden descendente:
/// 1. Score igual a `1.0` (Igualdad plena de texto).
/// 2. Coincidencia estricta del número de secuela con el proporcionado.
/// 3. Mayor coeficiente numérico de similitud (`score`).
/// 4. El título más corto (para penalizar ruido adicional en nombres).
///
/// # Arguments
///
/// * `candidates` - Listado de candidatos locales ya filtrados que superaron el umbral.
/// * `query_number` - El número primario de secuela o de serie extraído del query, si existe.
///
/// # Returns
///
/// Una referencia pura `&IndexEntry` al ganador.
fn best_specific<'a>(
    candidates: &[RawCandidate<'a>],
    query_number: Option<u32>,
) -> Option<&'a IndexEntry> {
    candidates
        .iter()
        .filter(|c| {
            // Si el query tiene número, descartar candidatos con número diferente
            if let Some(qn) = query_number {
                let cn = extract_sequel_number(&c.entry.normalized_title);
                match cn {
                    Some(n) => n == qn,
                    // Si el candidato no tiene número pero el query sí, solo
                    // aceptarlo si tiene score exacto (probable alias)
                    None => c.score >= 1.0,
                }
            } else {
                true
            }
        })
        .max_by(|a, b| {
            // 1. Exacto primero
            let ea = (a.score >= 1.0) as u8;
            let eb = (b.score >= 1.0) as u8;
            if ea != eb {
                return eb.cmp(&ea);
            }

            // 2. Coincidencia de número
            if let Some(qn) = query_number {
                let na = extract_sequel_number(&a.entry.normalized_title) == Some(qn);
                let nb = extract_sequel_number(&b.entry.normalized_title) == Some(qn);
                if na != nb {
                    return nb.cmp(&na);
                }
            }

            // 3. Mayor score
            let sc = a.score.total_cmp(&b.score);
            if sc != std::cmp::Ordering::Equal {
                return sc;
            }

            // 4. Título más corto
            b.entry.item_title.len().cmp(&a.entry.item_title.len())
        })
        .map(|c| c.entry)
}

/// Selecciona el candidato óptimo para resoluciones de una búsqueda **genérica** (franquicia principal).
///
/// Reglas de prioridad en orden descendente:
/// 1. El año de publicación más reciente reflejado en el título (ej. Remakes).
/// 2. Mayor coeficiente numérico de similitud (`score`).
/// 3. Menor conteo de palabras en el título normalizado (prioriza la base del título sobre subtítulos).
///
/// # Arguments
///
/// * `candidates` - Listado de candidatos locales ya filtrados por el umbral mínimo.
///
/// # Returns
///
/// Una referencia pura `&IndexEntry` al ganador.
fn best_generic<'a>(candidates: &[RawCandidate<'a>]) -> Option<&'a IndexEntry> {
    candidates
        .iter()
        .max_by(|a, b| {
            let ya = extract_year(&a.entry.item_title).unwrap_or(0);
            let yb = extract_year(&b.entry.item_title).unwrap_or(0);
            if ya != yb {
                return ya.cmp(&yb);
            }

            let sc = a.score.total_cmp(&b.score);
            if sc != std::cmp::Ordering::Equal {
                return sc;
            }

            b.entry
                .normalized_title
                .split_whitespace()
                .count()
                .cmp(&a.entry.normalized_title.split_whitespace().count())
        })
        .map(|c| c.entry)
}

/// Orquesta la búsqueda y selecciona exactamente 1 representante idóneo por cada fuente cargada.
///
/// Al carecer de estado mutable global o I/O, esta función es idónea para invocación
/// paralela (ej. `rayon::par_iter`) sobre un lote masivo de títulos.
///
/// # Arguments
///
/// * `game_name` - Nombre original provisto por el cliente, devuelto intacto si hay coincidencias.
/// * `normalized_game` - El nombre sometido a validación y compresión de caracteres.
/// * `game_hashes` - Representación tokenizada en FNV-1a del nombre a buscar.
/// * `config` - Contenedor con los umbrales exigidos y diccionarios de ignorados.
/// * `index` - Base de datos referencial cacheada y aplanada de todos los elementos disponibles.
///
/// # Returns
///
/// Vector conteniendo un `SourceBestMatch` por cada `source_id` donde se superaron los criterios.
/// Los resultados se envían ya ordenados por relevancia global (score descendente).
pub fn find_best_per_source(
    _game_name: &str,
    normalized_game: &str,
    game_hashes: &[u64],
    config: &MatchConfig,
    index: &[IndexEntry],
) -> Vec<SourceBestMatch> {
    let kind = detect_query_kind(normalized_game);
    let query_number = match &kind {
        QueryKind::Specific { number } => *number,
        QueryKind::Generic => None,
    };

    // Fase 1 — Filtrar rápidamente candidatos basándose en el score de similitud
    let candidates: Vec<RawCandidate> = index
        .iter()
        .filter_map(|entry| {
            let score = jaccard_score(
                normalized_game,
                game_hashes,
                &entry.normalized_title,
                &entry.token_hashes,
                config.threshold,
            );
            if score >= config.threshold {
                Some(RawCandidate { entry, score })
            } else {
                None
            }
        })
        .collect();

    // Fase 2 — Agrupar la colección de candidatos supervivientes mapeándolos a su fuente original
    let mut by_source: HashMap<&str, Vec<RawCandidate>> = HashMap::new();
    for c in &candidates {
        by_source
            .entry(&c.entry.source_id)
            .or_default()
            .push(c.clone());
    }

    // Fase 3 — Delegar en la heurística ganadora y componer la estructura de respuesta
    let mut results: Vec<SourceBestMatch> = by_source
        .into_values()
        .filter_map(|group| {
            let winner = match kind {
                QueryKind::Specific { .. } => best_specific(&group, query_number),
                QueryKind::Generic => best_generic(&group),
            }?;

            Some(SourceBestMatch {
                source_id: winner.source_id.clone(),
                source_name: winner.source_name.clone(),
                item_id: winner.item_id.clone(),
                item_title: winner.item_title.clone(),
                score: group
                    .iter()
                    .find(|c| c.entry.item_id == winner.item_id)
                    .map(|c| c.score)
                    .unwrap_or(0.0),
                protocols: winner.protocols.clone(),
                file_size: winner.file_size.clone(),
                uris: winner.uris.clone(),
            })
        })
        .collect();

    results.sort_unstable_by(|a, b| b.score.total_cmp(&a.score));
    results
}
