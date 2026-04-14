/**
 * Comandos reconocidos por el CLI (modo no interactivo).
 */
export const KNOWN_COMMANDS = [
  "add",
  "remove",
  "list",
  "config",
  "scan",
  "scan-paths",
  "upload",
  "download",
  "--help",
  "-h",
] as const;

/**
 * Acciones del menú principal interactivo.
 */
export type MainAction = "add" | "remove" | "list" | "scan" | "scan-paths" | "upload" | "download" | "config" | "exit";
