//! Modelos de dominio del subsistema de fuentes de descarga.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Catálogo importado desde JSON o URL remota.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCatalog {
    /// Identificador interno estable del catálogo.
    pub id: String,
    /// Nombre del proveedor/fuente.
    pub name: String,
    /// URL de origen cuando fue importado por enlace.
    pub source_url: Option<String>,
    /// Fecha de importación.
    pub imported_at: String,
    /// Entradas de descarga normalizadas.
    pub downloads: Vec<SourceItem>,
}

/// Entrada individual normalizada de un catálogo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceItem {
    /// Identificador interno del item.
    pub id: String,
    /// Título para mostrar en la UI.
    pub title: String,
    /// Lista priorizada de URIs de descarga.
    pub uris: Vec<SourceUri>,
    /// Fecha de publicación opcional del release.
    pub upload_date: Option<String>,
    /// Tamaño opcional de texto (se preserva tal cual viene).
    pub file_size: Option<String>,
    /// Metadatos adicionales no estandarizados.
    pub metadata: HashMap<String, Value>,
}

/// URI normalizada y clasificada por protocolo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUri {
    /// URI original.
    pub uri: String,
    /// Protocolo detectado.
    pub protocol: DownloadProtocol,
    /// Prioridad de uso (menor número = mayor prioridad).
    pub priority: usize,
}

/// Protocolo de transferencia detectado.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadProtocol {
    /// Descarga directa HTTP/HTTPS.
    Http,
    /// Enlace magnet (BitTorrent).
    TorrentMagnet,
    /// Archivo `.torrent`.
    TorrentFile,
    /// Protocolo no identificado.
    Unknown,
}

/// Estado de ejecución de un job de descarga.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceJobStatus {
    Queued,
    Running,
    Paused,
    Cancelled,
    Completed,
    Failed,
}

/// Job persistido de descarga del módulo `sources`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDownloadJob {
    pub job_id: String,
    pub source_id: String,
    pub item_id: String,
    pub title: String,
    pub destination_dir: String,
    pub selected_uri: String,
    pub protocol: DownloadProtocol,
    pub status: SourceJobStatus,
    pub loaded: u64,
    pub total: u64,
    pub error: Option<String>,
    /// ID externo asociado (ejemplo: info-hash torrent).
    pub external_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Modo de importación de catálogo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Merge,
    Replace,
}

/// Resumen liviano de catálogo para listados.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCatalogSummary {
    pub id: String,
    pub name: String,
    pub source_url: Option<String>,
    pub imported_at: String,
    pub downloads_count: usize,
}

/// Página de items para catálogos grandes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceItemsPage {
    pub source_id: String,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub items: Vec<SourceItem>,
}

/// Coincidencia detectada entre un juego del catálogo y una entrada de fuentes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatchCandidate {
    pub source_id: String,
    pub source_name: String,
    pub item_id: String,
    pub item_title: String,
    pub score: f32,
    pub protocols: Vec<DownloadProtocol>,
}

/// Resultado de matching para un juego individual.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatchResult {
    pub game_name: String,
    pub best: Option<SourceMatchCandidate>,
    pub candidates: Vec<SourceMatchCandidate>,
}
