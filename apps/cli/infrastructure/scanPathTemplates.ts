/**
 * Plantillas de rutas base para el escaneo de guardados.
 * Separado de scanFilters para mantener la configuración centralizada.
 */

export const BASE_PATH_TEMPLATES_WIN32: readonly string[] = [
  "%USERPROFILE%/Documents/My Games",
  "%USERPROFILE%/Documents",
  "%APPDATA%",
  "%LOCALAPPDATA%",
  "%USERPROFILE%/Saved Games",
  "%LOCALAPPDATA%/Low",
];

export const DEFAULT_STEAM_PATH_WIN32 = "C:\\Program Files (x86)\\Steam";
