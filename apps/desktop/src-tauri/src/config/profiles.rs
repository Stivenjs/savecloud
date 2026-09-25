//! Modelos de datos para la gestión de perfiles múltiples.
//!
//! Define la estructura de un perfil individual (`Profile`) y el índice que
//! mantiene la lista global de perfiles + el perfil activo (`ProfilesIndex`).
//!
//! Cada perfil encapsula toda la configuración de AppSettings, permitiendo
//! que múltiples usuarios locales compartan la misma máquina con credenciales
//! e historial independientes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const DEFAULT_PROFILE_ID: &str = "config-default";

/// Representa un perfil individual del usuario.
///
/// Un perfil encapsula toda la configuración necesaria para un usuario local,
/// incluyendo credenciales API, hosts en la nube accesibles, y preferencias visuales.
///
/// Los secretos (api_key) se guardan en OS Keyring, no en este struct.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Identificador único del perfil (UUID o slugificado).
    pub id: String,

    /// Nombre amigable del perfil mostrado en la UI.
    pub name: String,

    /// ID de usuario local en SaveCloud (usado en headers como `x-user-id`).
    pub local_user_id: String,

    /// URL base de la API del servidor backend.
    pub api_base_url: String,

    /// URL base del servidor WebSocket para notificaciones en tiempo real.
    pub ws_base_url: String,

    /// URL del avatar del perfil mostrado en el selector.
    #[serde(default)]
    pub profile_avatar_url: Option<String>,

    /// Timestamp Unix de creación del perfil.
    pub created_at: i64,

    /// Timestamp Unix del último acceso a este perfil.
    pub last_used: i64,

    /// Mapea `hostUserId` -> `apiBaseUrl` para nube de host invitador.
    #[serde(default)]
    pub cloud_host_api_base_urls: BTreeMap<String, String>,

    /// Mapea `hostUserId` -> `wsBaseUrl` del servidor WebSocket del host.
    #[serde(default)]
    pub cloud_host_ws_base_urls: BTreeMap<String, String>,

    /// Rutas de búsqueda personalizadas para escaneo de savefiles.
    #[serde(default)]
    pub custom_scan_paths: Vec<String>,

    /// Número máximo de backups a mantener por juego.
    #[serde(default)]
    pub keep_backups_per_game: Option<u32>,

    /// Habilita streaming de backups completos en lugar de descarga local.
    #[serde(default)]
    pub full_backup_streaming: Option<bool>,

    /// Modo prueba para streaming de backups (sin escritura real).
    #[serde(default)]
    pub full_backup_streaming_dry_run: Option<bool>,

    /// Nivel Zstd (1–22) para backup completo empaquetado en streaming.
    #[serde(default)]
    pub full_backup_packaged_compression_level: Option<i32>,

    /// Directorio por defecto para descargas de fuentes.
    #[serde(default)]
    pub default_source_download_dir: Option<String>,

    /// URL o ruta local: fondo del perfil.
    #[serde(default)]
    pub profile_background: Option<String>,

    /// URL, data URL o ruta local: marco superpuesto al avatar.
    #[serde(default)]
    pub profile_frame: Option<String>,

    /// Si es true, los anfitriones de nubes pueden ver avatar/fondo/marco.
    #[serde(default)]
    pub share_visual_profile_with_hosts: bool,

    /// Si es true, los miembros activos pueden ver avatar/fondo/marco.
    #[serde(default)]
    pub share_visual_profile_with_members: bool,

    /// Si es true, extrae automáticamente los juegos descargados al finalizar (ZIP, RAR, 7Z, TAR, etc.).
    #[serde(default = "default_true")]
    pub auto_extract_downloads: bool,
}

fn default_true() -> bool {
    true
}

/// Índice global de perfiles con metadatos de selección.
///
/// Se persiste en `profiles.json` en el directorio de configuración.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesIndex {
    /// Lista de todos los perfiles configurados.
    #[serde(default)]
    pub profiles: Vec<Profile>,

    /// ID del perfil activo (debe existir en `profiles`).
    pub active_profile_id: String,

    /// Si es true, mostrar selector siempre al iniciar app.
    #[serde(default)]
    pub always_show_selector: bool,
}

impl ProfilesIndex {
    /// Crea un nuevo índice vacío.
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
            active_profile_id: DEFAULT_PROFILE_ID.to_string(),
            always_show_selector: false,
        }
    }

    /// Busca un perfil por ID (referencia inmutable).
    pub fn get_profile(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    /// Busca un perfil por ID (referencia mutable).
    pub fn get_profile_mut(&mut self, id: &str) -> Option<&mut Profile> {
        self.profiles.iter_mut().find(|p| p.id == id)
    }

    /// Obtiene el perfil activo.
    pub fn get_active_profile(&self) -> Option<&Profile> {
        self.get_profile(&self.active_profile_id)
    }

    /// Obtiene el perfil activo (mutable).
    pub fn get_active_profile_mut(&mut self) -> Option<&mut Profile> {
        let id = self.active_profile_id.clone();
        self.get_profile_mut(&id)
    }

    /// Añade un nuevo perfil al índice.
    pub fn add_profile(&mut self, profile: Profile) {
        self.profiles.push(profile);
    }

    /// Elimina un perfil por ID.
    pub fn remove_profile(&mut self, id: &str) -> Option<Profile> {
        self.profiles
            .iter()
            .position(|p| p.id == id)
            .map(|pos| self.profiles.remove(pos))
    }
}

impl Default for ProfilesIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// DTO para exponer perfiles al frontend (sin API key).
///
/// Se usa en comandos Tauri para no revelar secretos al cliente.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDTO {
    pub id: String,
    pub name: String,
    pub local_user_id: String,
    pub api_base_url: String,
    pub ws_base_url: String,
    pub profile_avatar_url: Option<String>,
    pub created_at: i64,
    pub last_used: i64,
    pub cloud_host_count: usize,
    /// Leído del `settings.json` del perfil **activo** (no forma parte del índice de perfiles en disco).
    #[serde(default)]
    pub developer_mode: bool,
}

impl From<&Profile> for ProfileDTO {
    fn from(profile: &Profile) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            local_user_id: profile.local_user_id.clone(),
            api_base_url: profile.api_base_url.clone(),
            ws_base_url: profile.ws_base_url.clone(),
            profile_avatar_url: profile.profile_avatar_url.clone(),
            created_at: profile.created_at,
            last_used: profile.last_used,
            cloud_host_count: profile.cloud_host_api_base_urls.len(),
            developer_mode: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profiles_index_get_profile() {
        let mut index = ProfilesIndex::new();
        let profile = Profile {
            id: "test1".to_string(),
            name: "Test".to_string(),
            local_user_id: "test_user".to_string(),
            api_base_url: "http://api".to_string(),
            ws_base_url: "ws://ws".to_string(),
            profile_avatar_url: None,
            created_at: 0,
            last_used: 0,
            cloud_host_api_base_urls: BTreeMap::new(),
            cloud_host_ws_base_urls: BTreeMap::new(),
            custom_scan_paths: Vec::new(),
            keep_backups_per_game: None,
            full_backup_streaming: None,
            full_backup_streaming_dry_run: None,
            full_backup_packaged_compression_level: None,
            default_source_download_dir: None,
            profile_background: None,
            profile_frame: None,
            share_visual_profile_with_hosts: false,
            share_visual_profile_with_members: false,
            auto_extract_downloads: true,
        };
        index.add_profile(profile.clone());

        assert!(index.get_profile("test1").is_some());
        assert!(index.get_profile("nonexistent").is_none());
    }

    #[test]
    fn test_profile_dto_conversion() {
        let profile = Profile {
            id: "test1".to_string(),
            name: "Test".to_string(),
            local_user_id: "test_user".to_string(),
            api_base_url: "http://api".to_string(),
            ws_base_url: "ws://ws".to_string(),
            profile_avatar_url: None,
            created_at: 0,
            last_used: 0,
            cloud_host_api_base_urls: BTreeMap::new(),
            cloud_host_ws_base_urls: BTreeMap::new(),
            custom_scan_paths: Vec::new(),
            keep_backups_per_game: None,
            full_backup_streaming: None,
            full_backup_streaming_dry_run: None,
            full_backup_packaged_compression_level: None,
            default_source_download_dir: None,
            profile_background: None,
            profile_frame: None,
            share_visual_profile_with_hosts: false,
            share_visual_profile_with_members: false,
            auto_extract_downloads: true,
        };

        let dto = ProfileDTO::from(&profile);
        assert_eq!(dto.id, "test1");
        assert_eq!(dto.local_user_id, "test_user");
    }
}
