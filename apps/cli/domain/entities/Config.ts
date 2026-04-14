import type { ConfiguredGame } from "@cli/domain/entities/ConfiguredGame";

/**
 * Contenido del archivo de configuración del CLI.
 * Se persiste en disco (JSON); el dominio no conoce el formato de almacenamiento.
 */
export interface Config {
  readonly apiBaseUrl?: string;
  readonly apiKey?: string;
  readonly userId?: string;
  readonly games: readonly ConfiguredGame[];
  /** Rutas adicionales donde buscar carpetas con guardados (ej. "D:\", "E:\Games"). */
  readonly customScanPaths?: readonly string[];
}
