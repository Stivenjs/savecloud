//! Comandos Tauri para gestión de perfiles.
//!
//! Expone 8 funciones async como comandos IPC para que el frontend React
//! pueda crear, cambiar, listar y eliminar perfiles.

use super::profile_manager::ProfileManager;
use super::profiles::ProfileDTO;

fn merge_profile_dto_disk_session(mut dto: ProfileDTO) -> ProfileDTO {
    dto.developer_mode = super::load_settings().developer_mode;
    dto
}

/// Lista todos los perfiles disponibles.
///
/// # Returns
/// Vector de ProfileDTOs con todos los perfiles configurados.
#[tauri::command]
pub async fn list_profiles_cmd() -> Result<Vec<ProfileDTO>, String> {
    let index = ProfileManager::load_profiles()?;
    Ok(ProfileManager::profiles_to_dtos(&index.profiles))
}

/// Obtiene el perfil activo actual.
///
/// # Returns
/// ProfileDTO del perfil activo.
///
/// # Errors
/// Devuelve error si no hay perfil activo configurado.
#[tauri::command]
pub async fn get_active_profile_cmd() -> Result<ProfileDTO, String> {
    let index = ProfileManager::load_profiles()?;
    let dto = ProfileManager::get_active_profile_dto(&index)?;
    Ok(merge_profile_dto_disk_session(dto))
}

/// Cambia el perfil activo a uno específico.
///
/// **NOTA**: El frontend debe recargar el contexto después de este comando
/// (invalidar React Query cache, reconectar WebSocket, etc.).
///
/// # Arguments
/// * `profile_id` - ID del perfil a activar
///
/// # Returns
/// ProfileDTO del perfil ahora activo.
///
/// # Errors
/// Devuelve error si el perfil no existe o falla la persistencia.
#[tauri::command]
pub async fn set_active_profile_cmd(profile_id: String) -> Result<ProfileDTO, String> {
    let mut index = ProfileManager::load_profiles()?;
    let profile = ProfileManager::set_active_profile(&mut index, &profile_id)?;
    Ok(merge_profile_dto_disk_session(ProfileDTO::from(&profile)))
}

/// Crea un nuevo perfil.
///
/// # Arguments
/// * `name` - Nombre amigable del perfil
/// * `profile_avatar_url` - Avatar inicial del perfil (opcional)
///
/// # Returns
/// ProfileDTO del perfil recién creado.
///
/// # Errors
/// Devuelve error si falla la creación o la persistencia.
#[tauri::command]
pub async fn create_profile_cmd(
    name: String,
    profile_avatar_url: Option<String>,
) -> Result<ProfileDTO, String> {
    let mut index = ProfileManager::load_profiles()?;
    let profile = ProfileManager::create_profile(&mut index, name, profile_avatar_url)?;
    Ok(ProfileDTO::from(&profile))
}

/// Elimina un perfil existente.
///
/// **RESTRICCIÓN**: No permite eliminar el perfil activo. El usuario debe cambiar
/// de perfil primero.
///
/// # Arguments
/// * `profile_id` - ID del perfil a eliminar
///
/// # Errors
/// Devuelve error si intenta eliminar el perfil activo o si el perfil no existe.
#[tauri::command]
pub async fn delete_profile_cmd(profile_id: String) -> Result<(), String> {
    let mut index = ProfileManager::load_profiles()?;
    ProfileManager::delete_profile(&mut index, &profile_id)
}

/// Actualiza metadatos de un perfil (nombre, avatar URL).
///
/// # Arguments
/// * `profile_id` - ID del perfil a actualizar
/// * `name` - Nuevo nombre (opcional)
/// * `avatar_url` - Nueva URL de avatar (opcional)
///
/// # Returns
/// ProfileDTO del perfil actualizado.
///
/// # Errors
/// Devuelve error si el perfil no existe o falla la persistencia.
#[tauri::command]
pub async fn update_profile_metadata_cmd(
    profile_id: String,
    name: Option<String>,
    avatar_url: Option<String>,
) -> Result<ProfileDTO, String> {
    let mut index = ProfileManager::load_profiles()?;
    let profile =
        ProfileManager::update_profile_metadata(&mut index, &profile_id, name, avatar_url)?;
    Ok(ProfileDTO::from(&profile))
}

/// Establece si el selector de perfiles debe mostrarse siempre.
///
/// # Arguments
/// * `always_show` - true para mostrar siempre, false para solo si hay múltiples perfiles
///
/// # Errors
/// Devuelve error si falla la persistencia.
#[tauri::command]
pub async fn set_always_show_selector_cmd(always_show: bool) -> Result<(), String> {
    let mut index = ProfileManager::load_profiles()?;
    ProfileManager::set_always_show_selector(&mut index, always_show)
}

/// Obtiene la configuración actual del selector.
///
/// # Returns
/// true si el selector debe mostrarse siempre, false si solo cuando hay múltiples perfiles.
#[tauri::command]
pub async fn get_always_show_selector_cmd() -> Result<bool, String> {
    let index = ProfileManager::load_profiles()?;
    Ok(index.always_show_selector)
}
