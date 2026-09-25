//! Operaciones de entrada y salida para la persistencia de perfiles.
//!
//! Garantiza escrituras atómicas, carga del índice de perfiles,
//! y manejo del archivo `profiles.json` en el directorio de configuración.

use super::paths;
use super::profile_defaults::ensure_default_profile;
use super::profiles::ProfilesIndex;
use std::fs;
use std::path::PathBuf;

/// Obtiene la ruta del archivo `profiles.json`.
///
/// # Returns
/// Ruta completa del archivo `profiles.json` en el directorio de configuración.
///
/// # Errors
/// Devuelve error si el directorio de configuración no puede resolverse.
pub fn profiles_path() -> Result<PathBuf, String> {
    paths::profiles_index_path().ok_or("Unable to resolve profiles path".to_string())
}

fn legacy_profiles_path() -> Result<PathBuf, String> {
    paths::legacy_profiles_index_path().ok_or("Unable to resolve legacy profiles path".to_string())
}

/// Carga el índice de perfiles desde disco.
///
/// Si el archivo no existe, devuelve un índice vacío. Si está corrupto, intenta recuperarse.
///
/// # Returns
/// `Ok(ProfilesIndex)` con los perfiles cargados, o índice vacío si no existen.
pub fn load_profiles_index() -> Result<ProfilesIndex, String> {
    let path = profiles_path()?;
    let legacy_path = legacy_profiles_path()?;

    let source_path = if path.exists() {
        path
    } else if legacy_path.exists() {
        legacy_path
    } else {
        path
    };

    let mut index = if !source_path.exists() {
        ProfilesIndex::new()
    } else {
        let content = fs::read_to_string(&source_path)
            .map_err(|e| format!("Failed to read profiles.json: {e}"))?;
        serde_json::from_str::<ProfilesIndex>(&content)
            .map_err(|e| format!("Failed to parse profiles.json: {e}"))?
    };

    if ensure_default_profile(&mut index) {
        save_profiles_index(&index)?;
    }

    Ok(index)
}

/// Guarda el índice de perfiles en disco con escritura atómica.
///
/// Escribe a un archivo temporal primero y luego lo renombra para evitar
/// corrupción en caso de fallos de I/O (escritura atómica).
///
/// # Arguments
/// * `index` - Referencia al ProfilesIndex a guardar
///
/// # Errors
/// Devuelve error si falla la serialización o la escritura a disco.
pub fn save_profiles_index(index: &ProfilesIndex) -> Result<(), String> {
    let path = profiles_path()?;

    // Crear directorio padre si no existe
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Escribir a un archivo temporal
    let temp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize profiles: {e}"))?;
    if let Ok(existing) = fs::read_to_string(&path) {
        if existing == content {
            return Ok(());
        }
    }
    fs::write(&temp_path, content).map_err(|e| format!("Failed to write temp file: {e}"))?;

    // Renombrar atómicamente el archivo temporal al destino
    #[cfg(windows)]
    {
        // En Windows, necesitamos eliminar el archivo destino primero
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to remove old file: {e}"))?;
        }
    }

    fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename temp file: {e}"))?;

    Ok(())
}

/// Crea un respaldo del índice de perfiles antes de realizar cambios importantes.
///
/// # Errors
/// Devuelve error si falla la copia de seguridad.
pub fn backup_profiles_index() -> Result<(), String> {
    let primary = profiles_path()?;
    let legacy = legacy_profiles_path()?;
    let source_path = if primary.exists() { primary } else { legacy };

    if source_path.exists() {
        let backup_path = source_path.with_extension("json.backup");
        fs::copy(&source_path, backup_path)
            .map_err(|e| format!("Failed to backup profiles: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profiles_path_ok() {
        let result = profiles_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.to_string_lossy().contains("profiles.json"));
    }
}
