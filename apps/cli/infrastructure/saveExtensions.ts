/**
 * Extensiones de archivos de guardado — fuente única de verdad.
 * Usado por scanFilters y listSaveFiles para mantener consistencia.
 */

/** Extensiones exclusivas de guardados de juegos — alta confianza. */
export const STRONG_SAVE_EXTENSIONS: readonly string[] = [".sav", ".savx", ".save", ".sl2", ".state", ".sr"];

/**
 * Extensiones que pueden ser guardados pero también las usan apps normales.
 * Solo cuentan si hay 3+ archivos o si el nombre sugiere guardado.
 */
export const WEAK_SAVE_EXTENSIONS: readonly string[] = [".dat", ".bin", ".bak"];

/**
 * Extensiones adicionales para listado (config, bases de datos, etc.)
 * Usadas por listSaveFiles para incluir más tipos de archivos de guardado.
 */
export const EXTRA_LIST_EXTENSIONS: readonly string[] = [".json", ".db", ".sqlite", ".xml", ".cfg", ".ini"];

/** Todas las extensiones reconocidas como posibles guardados (para listado). */
export const ALL_SAVE_EXTENSIONS: readonly string[] = [
  ...STRONG_SAVE_EXTENSIONS,
  ...WEAK_SAVE_EXTENSIONS,
  ...EXTRA_LIST_EXTENSIONS,
];

/** Palabras en el nombre de archivo que sugieren que es un guardado. */
export const SAVE_NAME_HINTS: readonly string[] = [
  "save",
  "slot",
  "profile",
  "progress",
  "checkpoint",
  "autosave",
  "quicksave",
  "player",
  "game",
];
