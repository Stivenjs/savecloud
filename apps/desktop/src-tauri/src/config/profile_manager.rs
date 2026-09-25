//! Gestor centralizado de perfiles con lógica de negocio.
//!
//! Proporciona operaciones de alto nivel para crear, cambiar, actualizar y
//! eliminar perfiles, coordinando la persistencia con el Keyring del SO.

use super::io::{
    delete_secure_api_key_for_cloud_host_in_profile, delete_secure_api_key_for_profile,
    delete_secure_steam_web_api_key_for_profile,
};
use super::profile_io;
use super::profile_storage;
use super::profiles::{Profile, ProfileDTO, ProfilesIndex};
use chrono::Utc;
use uuid::Uuid;

pub struct ProfileManager;

impl ProfileManager {
    fn normalize_optional_string(value: Option<String>) -> Option<String> {
        value.and_then(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    }

    /// Carga el índice de perfiles del disco.
    pub fn load_profiles() -> Result<ProfilesIndex, String> {
        profile_io::load_profiles_index()
    }

    /// Obtiene el perfil activo actual.
    ///
    /// # Errors
    /// Devuelve error si no hay perfil activo configurado.
    pub fn get_active_profile(index: &ProfilesIndex) -> Result<Profile, String> {
        index
            .get_active_profile()
            .cloned()
            .ok_or_else(|| format!("No active profile found: {}", index.active_profile_id))
    }

    /// Obtiene el perfil activo como DTO (sin secretos).
    pub fn get_active_profile_dto(index: &ProfilesIndex) -> Result<ProfileDTO, String> {
        Self::get_active_profile(index).map(|p| ProfileDTO::from(&p))
    }

    /// Cambia el perfil activo y lo persiste.
    ///
    /// # Arguments
    /// * `index` - Índice de perfiles (mutable)
    /// * `profile_id` - ID del perfil a activar
    ///
    /// # Errors
    /// Devuelve error si el perfil no existe o si falla la persistencia.
    pub fn set_active_profile(
        index: &mut ProfilesIndex,
        profile_id: &str,
    ) -> Result<Profile, String> {
        // Validar que el perfil existe (usa referencia, no clona)
        let _profile = index
            .get_profile(profile_id)
            .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

        // Crear respaldo antes de un cambio persistente.
        profile_io::backup_profiles_index()?;

        // Cambiar perfil activo
        index.active_profile_id = profile_id.to_string();

        // Actualizar timestamp de último acceso del perfil activo.
        if let Some(p) = index.get_active_profile_mut() {
            p.last_used = Utc::now().timestamp();
        }

        // Persitir cambios
        profile_io::save_profiles_index(index)?;

        // Devolver el perfil actualizado
        index
            .get_profile(profile_id)
            .cloned()
            .ok_or_else(|| "Failed to retrieve active profile".to_string())
    }

    /// Crea un nuevo perfil y lo persiste.
    ///
    /// # Arguments
    /// * `index` - Índice de perfiles (mutable)
    /// * `name` - Nombre amigable del perfil
    /// * `profile_avatar_url` - Avatar inicial del perfil (opcional)
    ///
    /// La configuración cloud (user_id, urls, api_key) se completa después.
    ///
    /// # Errors
    /// Devuelve error si falla la persistencia o el Keyring.
    pub fn create_profile(
        index: &mut ProfilesIndex,
        name: String,
        profile_avatar_url: Option<String>,
    ) -> Result<Profile, String> {
        let profile_id = format!(
            "profile_{}",
            Uuid::new_v4()
                .to_string()
                .chars()
                .take(8)
                .collect::<String>()
        );
        let now = Utc::now().timestamp();

        let profile = Profile {
            id: profile_id.clone(),
            name,
            local_user_id: String::new(),
            api_base_url: String::new(),
            ws_base_url: String::new(),
            profile_avatar_url: Self::normalize_optional_string(profile_avatar_url),
            created_at: now,
            last_used: now,
            cloud_host_api_base_urls: Default::default(),
            cloud_host_ws_base_urls: Default::default(),
            custom_scan_paths: Default::default(),
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

        // Crear respaldo antes de un cambio persistente.
        profile_io::backup_profiles_index()?;

        // Crear en disco la estructura vacía del nuevo perfil antes de activarlo.
        profile_storage::initialize_profile_storage(&profile)?;

        // Añadir perfil al índice
        index.add_profile(profile.clone());

        // Persitir cambios
        profile_io::save_profiles_index(index)?;

        Ok(profile)
    }

    /// Elimina un perfil por ID.
    ///
    /// # Errors
    /// Devuelve error si intenta eliminar el perfil activo o si el perfil no existe.
    pub fn delete_profile(index: &mut ProfilesIndex, profile_id: &str) -> Result<(), String> {
        // No permitir eliminar el perfil activo
        if index.active_profile_id == profile_id {
            return Err(
                "Cannot delete active profile. Switch to another profile first.".to_string(),
            );
        }

        let target_profile = index
            .get_profile(profile_id)
            .cloned()
            .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

        // Eliminar del índice
        index.remove_profile(profile_id);

        // Eliminar la carpeta física del perfil en disco.
        profile_storage::delete_profile_storage(profile_id)?;

        // Crear respaldo antes de un cambio persistente.
        profile_io::backup_profiles_index()?;

        // Eliminar API key del Keyring (best effort, no error si falla)
        let _ = delete_secure_api_key_for_profile(profile_id);
        let _ = delete_secure_steam_web_api_key_for_profile(profile_id);
        for host_user_id in target_profile.cloud_host_api_base_urls.keys() {
            let _ = delete_secure_api_key_for_cloud_host_in_profile(profile_id, host_user_id);
        }

        // Persitir cambios
        profile_io::save_profiles_index(index)?;

        Ok(())
    }

    /// Actualiza metadatos del perfil (nombre, avatar URL).
    ///
    /// # Errors
    /// Devuelve error si el perfil no existe o si falla la persistencia.
    pub fn update_profile_metadata(
        index: &mut ProfilesIndex,
        profile_id: &str,
        name: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<Profile, String> {
        // Crear respaldo antes de un cambio persistente.
        profile_io::backup_profiles_index()?;

        let profile = index
            .get_profile_mut(profile_id)
            .ok_or_else(|| format!("Profile not found: {profile_id}"))?;

        if let Some(n) = name {
            profile.name = n;
        }
        if avatar_url.is_some() {
            profile.profile_avatar_url = avatar_url;
        }

        let updated = profile.clone();

        // Persitir cambios
        profile_io::save_profiles_index(index)?;

        Ok(updated)
    }

    /// Establece la opción de mostrar siempre el selector.
    ///
    /// # Errors
    /// Devuelve error si falla la persistencia.
    pub fn set_always_show_selector(
        index: &mut ProfilesIndex,
        always_show: bool,
    ) -> Result<(), String> {
        // Crear respaldo antes de un cambio persistente.
        profile_io::backup_profiles_index()?;
        index.always_show_selector = always_show;
        profile_io::save_profiles_index(index)?;
        Ok(())
    }

    /// Convierte lista de perfiles a DTOs (sin secretos).
    ///
    /// Evita clones innecesarios usando referencias.
    pub fn profiles_to_dtos(profiles: &[Profile]) -> Vec<ProfileDTO> {
        profiles.iter().map(ProfileDTO::from).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_profile_generates_unique_id() {
        let mut index = ProfilesIndex::new();
        let result = ProfileManager::create_profile(&mut index, "Test".to_string(), None);

        assert!(result.is_ok());
        let profile = result.unwrap();
        assert!(profile.id.starts_with("profile_"));
        assert_eq!(index.profiles.len(), 1);
    }

    #[test]
    fn test_delete_active_profile_fails() {
        let mut index = ProfilesIndex::new();
        let profile = Profile {
            id: "test1".to_string(),
            name: "Test".to_string(),
            local_user_id: "user1".to_string(),
            api_base_url: "http://api".to_string(),
            ws_base_url: "ws://ws".to_string(),
            profile_avatar_url: None,
            created_at: 0,
            last_used: 0,
            cloud_host_api_base_urls: Default::default(),
            cloud_host_ws_base_urls: Default::default(),
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

        index.add_profile(profile);
        index.active_profile_id = "test1".to_string();

        let result = ProfileManager::delete_profile(&mut index, "test1");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot delete active profile"));
    }
}
