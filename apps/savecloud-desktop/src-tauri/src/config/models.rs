//! Modelos de datos para la configuración y persistencia de la aplicación.
//!
//! Este módulo define las estructuras segregadas que se escriben en disco
//! para mejorar el rendimiento, así como la estructura combinada utilizada
//! para la sincronización con la nube y los DTOs expuestos al frontend.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Configuraciones generales de la aplicación y del usuario.
///
/// Esta estructura se persiste independientemente para evitar reescribir
/// toda la biblioteca de juegos cuando solo cambia una preferencia.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub api_base_url: Option<String>,
    /// Clave de autenticación de la API.
    ///
    /// Se excluye intencionalmente de la serialización JSON para evitar
    /// almacenar secretos en texto plano. Su gestión se delega al OS.
    #[serde(skip_serializing, default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub active_cloud_host_user_id: Option<String>,
    /// Mapea `hostUserId` (anfitrión) -> `apiBaseUrl` del servidor donde vive esa nube invitada.
    ///
    /// Las credenciales secretas (`apiKey`/accessToken) se guardan aparte en el Keyring por `hostUserId`.
    #[serde(default)]
    pub cloud_host_api_base_urls: BTreeMap<String, String>,
    #[serde(default)]
    pub custom_scan_paths: Vec<String>,
    #[serde(default)]
    pub keep_backups_per_game: Option<u32>,
    #[serde(default)]
    pub full_backup_streaming: Option<bool>,
    #[serde(default)]
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub default_source_download_dir: Option<String>,
    /// URL o ruta local: fondo del perfil (imagen, GIF o vídeo).
    #[serde(default)]
    pub profile_background: Option<String>,
    /// URL, data URL o ruta local: avatar del perfil.
    #[serde(default)]
    pub profile_avatar: Option<String>,
    /// URL o ruta local: marco superpuesto al avatar (PNG recomendado).
    #[serde(default)]
    pub profile_frame: Option<String>,
    /// Clave [Steam Web API](https://steamcommunity.com/dev/apikey) para `IStoreService/GetAppList` (catálogo local).
    ///
    /// No se serializa en JSON; se guarda en el almacén seguro del SO (Keyring), igual que `api_key`.
    #[serde(skip_serializing, default)]
    pub steam_web_api_key: Option<String>,
}

/// Biblioteca local de juegos configurados.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLibrary {
    #[serde(default)]
    pub games: Vec<ConfiguredGame>,
}

/// Historial local de operaciones realizadas.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationHistory {
    #[serde(default)]
    pub entries: Vec<OperationLogEntry>,
}

/// Representa la configuración individual de un juego.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredGame {
    pub id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub steam_app_id: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub executable_names: Option<Vec<String>>,
    #[serde(default)]
    pub edition_label: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub magnet_link: Option<String>,
    /// Ruta absoluta al .exe para abrir el juego desde la app (opcional).
    #[serde(default)]
    pub launch_executable_path: Option<String>,
    #[serde(default)]
    pub playtime_seconds: u64,
}

/// Entrada descriptiva de una operación de sincronización completada.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntry {
    pub timestamp: String,
    pub kind: String,
    pub game_id: String,
    pub file_count: u32,
    pub err_count: u32,
}

/// Gamificación y estadísticas locales; viaja en el JSON monolítico (export, import, nube).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamificationConfig {
    #[serde(default)]
    pub upload_success_count: u64,
    #[serde(default)]
    pub utc_days_with_sync: Vec<String>,
    #[serde(default)]
    pub utc_days_with_play: Vec<String>,
    #[serde(default)]
    pub weekly_playtime_seconds: u64,
    #[serde(default)]
    pub week_id: String,
    #[serde(default)]
    pub achievements_unlocked: Vec<String>,
    #[serde(default)]
    pub pending_achievement_toasts: Vec<String>,
    #[serde(default)]
    pub seen_shortcuts_hint: bool,
    #[serde(default)]
    pub last_weekly_digest_notification_week_id: String,
}

/// Vista unificada de la configuración completa.
///
/// Combina [`AppSettings`], [`GameLibrary`] y [`OperationHistory`].
/// Se utiliza exclusivamente para retrocompatibilidad, importación,
/// exportación y transferencias hacia la nube (S3).
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    #[serde(default)]
    pub active_cloud_host_user_id: Option<String>,
    pub custom_scan_paths: Vec<String>,
    pub keep_backups_per_game: Option<u32>,
    pub full_backup_streaming: Option<bool>,
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub default_source_download_dir: Option<String>,
    /// Perfil (mismos campos que `AppSettings`; incluidos en export/import y backup en nube).
    #[serde(default)]
    pub profile_background: Option<String>,
    #[serde(default)]
    pub profile_avatar: Option<String>,
    #[serde(default)]
    pub profile_frame: Option<String>,
    pub games: Vec<ConfiguredGame>,
    #[serde(default)]
    pub operation_history: Vec<OperationLogEntry>,
    #[serde(default)]
    pub gamification: GamificationConfig,
}

/// Objeto de transferencia de datos (DTO) de la configuración principal,
/// formateado para ser consumido por el frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    #[serde(default)]
    pub active_cloud_host_user_id: Option<String>,
    pub games: Vec<GameDto>,
    pub custom_scan_paths: Vec<String>,
    pub keep_backups_per_game: Option<u32>,
    pub full_backup_streaming: Option<bool>,
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub default_source_download_dir: Option<String>,
    pub total_playtime: u64,
    #[serde(default)]
    pub profile_background: Option<String>,
    #[serde(default)]
    pub profile_avatar: Option<String>,
    #[serde(default)]
    pub profile_frame: Option<String>,
    /// Presente solo si hay clave configurada; valor enmascarado hacia la UI.
    #[serde(default)]
    pub steam_web_api_key: Option<String>,
}

/// DTO representativo de un juego para el frontend.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDto {
    pub id: String,
    pub paths: Vec<String>,
    pub steam_app_id: Option<String>,
    pub image_url: Option<String>,
    pub edition_label: Option<String>,
    pub source_url: Option<String>,
    pub magnet_link: Option<String>,
    #[serde(default)]
    pub executable_names: Option<Vec<String>>,
    #[serde(default)]
    pub launch_executable_path: Option<String>,
    pub playtime_seconds: u64,
}

/// DTO del historial de operaciones para el frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntryDto {
    pub timestamp: String,
    pub kind: String,
    pub game_id: String,
    pub file_count: u32,
    pub err_count: u32,
}

/// Valor centinela utilizado para enmascarar la API Key hacia el frontend.
/// Evita que secretos viajen en texto plano a la interfaz gráfica.
pub const MASKED_API_KEY: &str = "******** (Protegida por el sistema)";

/// Mismo criterio que [`MASKED_API_KEY`] para la clave Steam Web API.
pub const MASKED_STEAM_WEB_API_KEY: &str = MASKED_API_KEY;
