//! Subsistema de enriquecimiento de torrents y magnet links.
//!
//! # Arquitectura
//!
//! Este módulo actúa como una capa de preprocesamiento entre la entrada del
//! usuario (magnet links o archivos `.torrent`) y el motor de `librqbit`.
//! Expone funciones puras para la manipulación de URIs e interactúa con
//! fuentes externas (HTTP) de forma asíncrona para nutrir los torrents con
//! listas de trackers actualizadas.
//!
//! # Comportamiento
//!
//! 1. Descarga listas de trackers públicos de alta calidad en tiempo de ejecución.
//! 2. Parsea y reconstruye magnet links de forma segura, garantizando el URL-encoding.
//! 3. Filtra esquemas inválidos y evita la duplicación de trackers existentes.
//!
//! # Limitaciones
//!
//! La estrategia de escalado temporal (pasar de `best` a `all_udp` tras 30-60s)
//! requiere inyectar trackers a una sesión de `librqbit` en pleno vuelo.
//! Actualmente, este módulo prepara el terreno proporcionando los distintos
//! niveles (Tiers) de trackers, pero la inyección dinámica en torrents activos
//! deberá gestionarse en la tarea `spawn_progress_monitor`.
//!
//! # Seguridad
//!
//! - Las operaciones de red usan un timeout estricto para evitar bloquear
//!   las tareas de Tauri.
//! - El parseo de URLs utiliza la caja robusta `url`, previniendo inyecciones
//!   o malformaciones en la cadena del magnet.
//! - Es idempotente: enriquecer un magnet ya enriquecido no tiene efectos secundarios.

use crate::commands::logs::sync_logger;
use std::collections::HashSet;
use std::time::Duration;
use url::Url;

/// URL base del repositorio de trackers de ngosang.
const TRACKER_BASE_URL: &str = "https://raw.githubusercontent.com/ngosang/trackerslist/master";

/// Tiempo máximo de espera para obtener trackers dinámicos.
/// Evita que el usuario de SaveCloud se quede esperando indefinidamente en la UI.
const FETCH_TIMEOUT: Duration = Duration::from_secs(4);

/// Lista de fallback integrada en caso de que GitHub/ngosang no sea accesible.
/// Contiene trackers UDP/HTTP conocidos por su alta disponibilidad.
const FALLBACK_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://9.rarbg.com:2810/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
    "https://tracker.tamersunion.org:443/announce",
];

/// Define el nivel de agresividad al obtener trackers, preparado para futuras
/// extensiones (reintentos dinámicos).
#[allow(dead_code)]
pub enum TrackerTier {
    /// Recomendado: minimiza el overhead de red.
    Best,
    /// Fallback intermedio tras 30-60 segundos sin peers.
    AllUdp,
    /// Último recurso.
    All,
}

impl TrackerTier {
    fn filename(&self) -> &'static str {
        match self {
            TrackerTier::Best => "trackers_best.txt",
            TrackerTier::AllUdp => "trackers_all_udp.txt",
            TrackerTier::All => "trackers_all.txt",
        }
    }
}

/// Obtiene una lista fresca de trackers desde la red o usa el fallback local.
///
/// # Comportamiento
/// Intenta descargar el archivo de texto correspondiente al `tier`. Divide el
/// resultado por líneas, filtrando esquemas válidos (`udp`, `http`, `https`) y
/// descartando líneas vacías. Nunca devuelve un vector vacío.
pub async fn fetch_trackers(tier: TrackerTier) -> Vec<String> {
    let url = format!("{}/{}", TRACKER_BASE_URL, tier.filename());

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .unwrap_or_default();

    let text = match client.get(&url).send().await {
        Ok(response) if response.status().is_success() => response.text().await.unwrap_or_default(),
        _ => String::new(), // Dispara el fallback inferior
    };

    let mut trackers: Vec<String> = text
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|s| {
            s.starts_with("udp://") || s.starts_with("http://") || s.starts_with("https://")
        })
        .map(|s| s.to_string())
        .collect();

    // Fallback absoluto si la red falla o el parseo es vacío
    if trackers.is_empty() {
        sync_logger::log_error(
            "fetch_trackers",
            "Fallo al obtener trackers dinámicos. Usando fallback local.",
            "No se pudieron obtener trackers dinámicos. Usando fallback local.",
        );
        trackers = FALLBACK_TRACKERS.iter().map(|&s| s.to_string()).collect();
    }

    trackers
}

/// Enriquece un magnet link añadiendo trackers faltantes de forma segura.
///
/// # Comportamiento
/// Descompone el magnet link usando especificaciones URL estándar. Preserva
/// todos los parámetros existentes (`xt`, `dn`, etc.) y extrae los trackers
/// actuales (`tr`). Añade los nuevos trackers asegurando que no haya duplicados
/// y que el resultado esté correctamente codificado (URL encoded).
pub fn enrich_magnet(magnet: &str, new_trackers: &[String]) -> String {
    let Ok(mut parsed_url) = Url::parse(magnet) else {
        sync_logger::log_error(
            "enrich_magnet",
            "Fallo al parsear el magnet link. Devolviendo original.",
            "No se pudo parsear el magnet link. Devolviendo original.",
        );
        return magnet.to_string();
    };

    let mut query_pairs = Vec::new();
    let mut existing_trackers = HashSet::new();
    let mut has_dn = false;

    // --- CÓDIGO CORREGIDO ---
    for (key, value) in parsed_url.query_pairs() {
        // 1. Convertimos el Cow a String una sola vez al inicio
        let k_str = key.into_owned();
        let v_str = value.into_owned();

        if k_str == "tr" {
            // Clonamos el String para el HashSet, manteniendo v_str vivo
            existing_trackers.insert(v_str.clone());
        }
        if k_str == "dn" {
            has_dn = true;
        }

        // 2. Movemos ambos Strings al Vector sin problemas
        query_pairs.push((k_str, v_str));
    }
    // -------------------------

    let mut added_count = 0;

    for tracker in new_trackers {
        if !existing_trackers.contains(tracker) {
            query_pairs.push(("tr".to_string(), tracker.clone()));
            existing_trackers.insert(tracker.clone());
            added_count += 1;
        }
    }

    if !has_dn {
        query_pairs.push(("dn".to_string(), "SaveCloud_Download".to_string()));
    }

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in query_pairs {
        serializer.append_pair(&k, &v);
    }

    parsed_url.set_query(Some(&serializer.finish()));

    if added_count > 0 {
        sync_logger::log_operation(
            "enrich_magnet",
            &format!(
                "Magnet enriquecido exitosamente: añadidos {} trackers.",
                added_count
            )[..],
        );
    }

    parsed_url.to_string()
}

/// Construye un magnet link base a partir de un info_hash en hexadecimal.
pub fn build_magnet_from_info_hash(info_hash: &str) -> String {
    format!("magnet:?xt=urn:btih:{}", info_hash)
}
