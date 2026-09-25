//! Modelos de dominio del subsistema de fuentes de descarga.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Metadatos de sincronización remota de una fuente.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct SourceSyncMetadata {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_hash: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_synced_at: Option<String>,
    pub sync_error: Option<String>,
}

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
    /// Información de sincronización remota, si aplica.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync: Option<SourceSyncMetadata>,
}

/// Configuración de una fuente remota registrada para sincronización manual.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSourceConfig {
    pub id: String,
    pub url: String,
    pub enabled: bool,
    #[serde(default)]
    pub sync: SourceSyncMetadata,
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
    /// Transferencia desde peer en LAN.
    PeerLan,
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
    Extracting,
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
    #[serde(default)]
    pub download_speed_bytes: u64,
    #[serde(default)]
    pub eta_seconds: Option<u64>,
    pub error: Option<String>,
    /// ID externo asociado (ejemplo: info-hash torrent).
    pub external_id: Option<String>,
    /// Nombre de archivo en disco para descargas HTTP (tras resolver URI).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file_name: Option<String>,
    /// Detalle o fase del estado en tiempo real (ejemplo: etapa del crawler durante bypass).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_detail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Modo de importación de catálogo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    /// Agrega nuevo o reemplaza si el ID coincide exactamente.
    Merge,
    /// Reemplaza todo el catálogo existente con el nuevo.
    Replace,
    /// Busca por nombre de fuente: actualiza si existe, crea si no.
    /// Útil para archivos locales que cambian de contenido (generan ID diferente).
    UpdateOrCreate,
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

/// Resultado de importación batch para un archivo individual.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchImportItemResult {
    pub path: String,
    pub success: bool,
    pub catalog_id: Option<String>,
    pub catalog_name: Option<String>,
    pub error: Option<String>,
    pub was_updated: bool,
}

/// Resultado completo de importación batch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchImportResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<BatchImportItemResult>,
}

/// Resultado por fuente al sincronizar URLs remotas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncItemResult {
    pub source_id: String,
    pub url: String,
    pub success: bool,
    pub updated: bool,
    pub catalog_id: Option<String>,
    pub catalog_name: Option<String>,
    pub error: Option<String>,
}

/// Resultado agregado de sincronización manual de fuentes remotas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncResult {
    pub total: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub failed: usize,
    pub items: Vec<RemoteSyncItemResult>,
}
