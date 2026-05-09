//! JSON de runtime con datos reversibles entre activaciones.

use serde::{Deserialize, Serialize};

use crate::config::paths;

const SESSION_FORMAT_VERSION: u32 = 1;

/// Datos para deshacer sólo los efectos que aplicó modo juego.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameModeSessionFile {
    #[serde(default)]
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) windows_previous_power_scheme_guid: Option<String>,
    /// True si modificamos DVR; restaurar según campos siguientes.
    #[serde(default)]
    pub(crate) windows_capture_changed: bool,
    /// Antes estaba ausente DWORD `AppCaptureEnabled`: restaurar borrando valor.
    #[serde(default)]
    pub(crate) windows_capture_key_was_missing: bool,
    /// Valor anterior del DWORD cuando existía.
    #[serde(default)]
    pub(crate) windows_game_dvr_capture_before: Option<u32>,
    #[serde(default)]
    pub(crate) linux_power_profile_before: Option<String>,
    #[serde(default)]
    pub(crate) macos_caffeinate_pid: Option<u32>,
    #[serde(default)]
    pub(crate) paused_torrents: Vec<String>,
    #[serde(default)]
    pub(crate) paused_source_jobs: Vec<String>,
    #[serde(default)]
    pub(crate) upload_pause_caused_by_mode: bool,
}

pub(crate) fn load_session() -> GameModeSessionFile {
    paths::game_mode_session_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(|| GameModeSessionFile {
            version: SESSION_FORMAT_VERSION,
            ..Default::default()
        })
}

pub(crate) fn save_session(session: &GameModeSessionFile) -> Result<(), String> {
    let path = paths::game_mode_session_path().ok_or("Ruta modo juego no disponible")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir runtime: {e}"))?;
    }
    let mut s = session.clone();
    s.version = SESSION_FORMAT_VERSION;
    let json = serde_json::to_string_pretty(&s).map_err(|e| format!("serde modo juego: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("escribir session modo juego: {e}"))
}

pub(crate) fn clear_session_file() -> Result<(), String> {
    let Some(path) = paths::game_mode_session_path() else {
        return Ok(());
    };
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("eliminar session modo juego: {e}"))?;
    }
    Ok(())
}
