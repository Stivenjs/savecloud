//! Modelos de datos para la configuración y persistencia de la aplicación.
//!
//! Este módulo define las estructuras segregadas que se escriben en disco
//! para mejorar el rendimiento, así como la estructura combinada utilizada
//! para la sincronización con la nube y los DTOs expuestos al frontend.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Nivel Zstd usado si no hay preferencia guardada (mismo valor que antes de exponer la opción).
pub const FULL_BACKUP_PACKAGED_ZSTD_DEFAULT: i32 = 5;

/// Configuraciones generales de la aplicación y del usuario.
///
/// Esta estructura se persiste independientemente para evitar reescribir
/// toda la biblioteca de juegos cuando solo cambia una preferencia.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub ws_base_url: Option<String>,
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
    /// Mapea `hostUserId` (anfitrión) -> `wsBaseUrl` del servidor de WebSocket.
    #[serde(default)]
    pub cloud_host_ws_base_urls: BTreeMap<String, String>,
    #[serde(default)]
    pub custom_scan_paths: Vec<String>,
    #[serde(default)]
    pub keep_backups_per_game: Option<u32>,
    #[serde(default)]
    pub full_backup_streaming: Option<bool>,
    #[serde(default)]
    pub full_backup_streaming_dry_run: Option<bool>,
    /// Nivel Zstd (1–22) para backups completos en modo streaming empaquetado. `None` = 5 (histórico en la app).
    #[serde(default)]
    pub full_backup_packaged_compression_level: Option<i32>,
    #[serde(default)]
    pub preferred_gamepad_layout: Option<String>,
    /// `normal` | `big_picture` — cómo mostrar la ventana principal al iniciar.
    #[serde(default)]
    pub startup_window_mode: Option<String>,
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
    /// Si es true, los anfitriones de nubes donde este usuario es miembro pueden ver avatar/fondo/marco en el perfil cargado.
    #[serde(default)]
    pub share_visual_profile_with_hosts: bool,
    /// Si es true, los miembros activos de la nube de este usuario (anfitrión) pueden ver avatar/fondo/marco al cargar su perfil.
    #[serde(default)]
    pub share_visual_profile_with_members: bool,
    /// Si es true, publica el inventario verificado de juegos instalados a los miembros del cloud (opt-out).
    #[serde(default = "default_true")]
    pub share_game_inventory_with_cloud: bool,
    /// Clave [Steam Web API](https://steamcommunity.com/dev/apikey) para `IStoreService/GetAppList` (catálogo local).
    ///
    /// No se serializa en JSON; se guarda en el almacén seguro del SO (Keyring), igual que `api_key`.
    #[serde(skip_serializing, default)]
    pub steam_web_api_key: Option<String>,
    /// Modo juego: activa mitigaciones conservadoras (SaveCloud + ajustes de SO donde aplique).
    #[serde(default)]
    pub game_mode_enabled: bool,
    /// En Windows/Linux/macOS: aplicar perfil de energía / rendimiento cuando el modo está activo.
    #[serde(default = "default_true")]
    pub game_mode_apply_power_profile: bool,
    /// Solo Windows (HKCU): reduce captura DVR de Xbox/Game Bar; opcional por si el jugador usa otras herramientas.
    #[serde(default)]
    pub game_mode_reduce_capture_overhead: bool,
    /// Pausar subidas/torrents/descargas de fuentes de SaveCloud mientras el modo está activo.
    #[serde(default = "default_true")]
    pub game_mode_throttle_savecloud_background: bool,
    /// Detectar si un juego de la biblioteca está en ejecución y darle más prioridad de CPU (automático).
    #[serde(default)]
    pub game_mode_boost_detected_game_cpu: bool,
    /// Por perfil (`settings.json` del perfil activo): DevTools del webview, atajos y herramientas de plugins en UI.
    #[serde(default)]
    pub developer_mode: bool,
    /// URL del proxy HTTP/HTTPS/SOCKS5 para enrutar las descargas de hosters.
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// Si es true, extrae automáticamente los juegos descargados al finalizar (ZIP, RAR, 7Z, TAR, etc.).
    #[serde(default = "default_true")]
    pub auto_extract_downloads: bool,
    /// Modo bajo rendimiento para reducir animaciones y consumo de CPU/GPU en PCs lentas.
    #[serde(default)]
    pub low_performance_mode: bool,
    /// Desactivar aceleración por hardware (GPU) en el webview.
    #[serde(default)]
    pub disable_hardware_acceleration: bool,
    /// Idioma preferido de la aplicación ("es", "en", etc.).
    #[serde(default)]
    pub language: Option<String>,
}

fn default_true() -> bool {
    true
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
    #[serde(default)]
    pub ws_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    #[serde(default)]
    pub active_cloud_host_user_id: Option<String>,
    #[serde(default)]
    pub cloud_host_ws_base_urls: BTreeMap<String, String>,
    pub custom_scan_paths: Vec<String>,
    pub keep_backups_per_game: Option<u32>,
    pub full_backup_streaming: Option<bool>,
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub full_backup_packaged_compression_level: Option<i32>,
    #[serde(default)]
    pub preferred_gamepad_layout: Option<String>,
    #[serde(default)]
    pub startup_window_mode: Option<String>,
    #[serde(default)]
    pub default_source_download_dir: Option<String>,
    /// Perfil (mismos campos que `AppSettings`; incluidos en export/import y backup en nube).
    #[serde(default)]
    pub profile_background: Option<String>,
    #[serde(default)]
    pub profile_avatar: Option<String>,
    #[serde(default)]
    pub profile_frame: Option<String>,
    #[serde(default)]
    pub share_visual_profile_with_hosts: bool,
    #[serde(default)]
    pub share_visual_profile_with_members: bool,
    #[serde(default = "default_true")]
    pub share_game_inventory_with_cloud: bool,
    pub games: Vec<ConfiguredGame>,
    #[serde(default)]
    pub operation_history: Vec<OperationLogEntry>,
    #[serde(default)]
    pub gamification: GamificationConfig,
    /// Preferencias modo juego (incluidas en export/import monolítico).
    #[serde(default)]
    pub game_mode_enabled: bool,
    #[serde(default = "default_true")]
    pub game_mode_apply_power_profile: bool,
    #[serde(default)]
    pub game_mode_reduce_capture_overhead: bool,
    #[serde(default = "default_true")]
    pub game_mode_throttle_savecloud_background: bool,
    #[serde(default)]
    pub game_mode_boost_detected_game_cpu: bool,
    #[serde(default)]
    pub developer_mode: bool,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default = "default_true")]
    pub auto_extract_downloads: bool,
    #[serde(default)]
    pub low_performance_mode: bool,
    #[serde(default)]
    pub disable_hardware_acceleration: bool,
}

/// Objeto de transferencia de datos (DTO) de la configuración principal,
/// formateado para ser consumido por el frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub ws_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    #[serde(default)]
    pub active_cloud_host_user_id: Option<String>,
    #[serde(default)]
    pub cloud_host_ws_base_urls: BTreeMap<String, String>,
    pub games: Vec<GameDto>,
    pub custom_scan_paths: Vec<String>,
    pub keep_backups_per_game: Option<u32>,
    pub full_backup_streaming: Option<bool>,
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub full_backup_packaged_compression_level: Option<i32>,
    #[serde(default)]
    pub preferred_gamepad_layout: Option<String>,
    #[serde(default)]
    pub startup_window_mode: Option<String>,
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
    #[serde(default)]
    pub share_visual_profile_with_hosts: bool,
    #[serde(default)]
    pub share_visual_profile_with_members: bool,
    #[serde(default = "default_true")]
    pub share_game_inventory_with_cloud: bool,
    #[serde(default)]
    pub game_mode_enabled: bool,
    #[serde(default = "default_true")]
    pub game_mode_apply_power_profile: bool,
    #[serde(default)]
    pub game_mode_reduce_capture_overhead: bool,
    #[serde(default = "default_true")]
    pub game_mode_throttle_savecloud_background: bool,
    #[serde(default)]
    pub game_mode_boost_detected_game_cpu: bool,
    #[serde(default)]
    pub developer_mode: bool,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default = "default_true")]
    pub auto_extract_downloads: bool,
    pub low_performance_mode: bool,
    pub disable_hardware_acceleration: bool,
    #[serde(default)]
    pub language: Option<String>,
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
