//! Rutas base y ubicaciones de guardados usadas en el escaneo.
//! Aquí se centralizan todas las rutas hardcodeadas; el módulo `mod` solo contiene lógica.

// ─── Steam (Windows) ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub const DEFAULT_STEAM_PATH_WIN32: &str = "C:\\Program Files (x86)\\Steam";

// ─── Rutas base para escaneo (Documents, AppData, etc.) ─────────────────────

/// Plantillas (ruta, etiqueta) para el escaneo base. Definición según plataforma.
#[cfg(target_os = "windows")]
pub const BASE_SCAN_TEMPLATES: &[(&str, &str)] = &[
    ("%USERPROFILE%\\Documents\\My Games", "Documents/My Games"),
    ("%USERPROFILE%\\Documents", "Documents"),
    ("%USERPROFILE%\\AppData\\LocalLow", "LocalLow"),
    ("%USERPROFILE%\\Saved Games", "Saved Games"),
    ("%LOCALAPPDATA%", "LocalAppData"),
    ("%LOCALAPPDATA%\\Low", "LocalAppData/Low"),
    ("%APPDATA%", "AppData"),
];

#[cfg(not(target_os = "windows"))]
pub const BASE_SCAN_TEMPLATES: &[(&str, &str)] = &[
    ("~/.local/share", "Local Share"),
    ("~/.config", "Config"),
    ("~/Documents", "Documents"),
];

// ─── Ubicaciones de guardados de cracks / emuladores Steam ───────────────────
// (ruta con posibles %VAR%, etiqueta para mostrar)

#[cfg(target_os = "windows")]
pub const CRACK_SAVE_LOCATIONS: &[(&str, &str)] = &[
    ("C:\\Users\\Public\\Documents\\EMPRESS", "EMPRESS"),
    ("C:\\Users\\Public\\Documents\\Steam", "CODEX/Steam emu"),
    ("%APPDATA%\\Goldberg SteamEmu Saves", "Goldberg"),
    ("%APPDATA%\\CODEX", "CODEX"),
    ("%APPDATA%\\CPY_SAVES", "CPY (Conspir4cy)"),
    ("%APPDATA%\\Skidrow", "Skidrow"),
    ("%APPDATA%\\FLT", "FLT"),
    ("%APPDATA%\\RUNE", "RUNE"),
    ("%LOCALAPPDATA%\\CODEX", "CODEX (Local)"),
    ("%USERPROFILE%\\Documents\\CPY_SAVES", "CPY (Documents)"),
];
