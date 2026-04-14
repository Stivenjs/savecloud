/**
 * Rutas conocidas donde los cracks populares (EMPRESS, CODEX, Goldberg, etc.)
 * guardan saves. Cada entrada tiene la ruta base (con %VAR% de entorno) y un label.
 * Dentro, cada subcarpeta suele ser un AppID de Steam.
 */
export const CRACK_SAVE_LOCATIONS: readonly { path: string; label: string }[] = [
  { path: "C:\\Users\\Public\\Documents\\EMPRESS", label: "EMPRESS" },
  { path: "C:\\Users\\Public\\Documents\\Steam", label: "CODEX/Steam emu" },
  { path: "%APPDATA%\\Goldberg SteamEmu Saves", label: "Goldberg" },
  { path: "%APPDATA%\\CODEX", label: "CODEX" },
  { path: "%APPDATA%\\CPY_SAVES", label: "CPY (Conspir4cy)" },
  { path: "%APPDATA%\\Skidrow", label: "Skidrow" },
  { path: "%LOCALAPPDATA%\\CODEX", label: "CODEX (Local)" },
  { path: "%USERPROFILE%\\Documents\\CPY_SAVES", label: "CPY (Documents)" },
];
