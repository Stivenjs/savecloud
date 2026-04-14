import type { PathCandidate } from "@cli/domain/entities/PathCandidate";

/**
 * Puerto para escanear el sistema de archivos en busca de carpetas
 * que podrían contener guardados de juegos.
 */
export interface PathScanner {
  scan(extraPaths?: readonly string[]): Promise<PathCandidate[]>;
}
