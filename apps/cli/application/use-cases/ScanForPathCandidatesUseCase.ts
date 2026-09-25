import type { PathCandidate } from "@cli/domain/entities/PathCandidate";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";
import type { PathScanner } from "@cli/domain/ports/PathScanner";

export type ScanForPathCandidatesOutput = PathCandidate[];

/**
 * Escanea rutas típicas del SO (+ rutas personalizadas del usuario)
 * en busca de carpetas que podrían ser guardados de juegos.
 */
export class ScanForPathCandidatesUseCase {
  constructor(
    private readonly pathScanner: PathScanner,
    private readonly configRepository: ConfigRepository
  ) {}

  async execute(): Promise<ScanForPathCandidatesOutput> {
    const config = await this.configRepository.load();
    return this.pathScanner.scan(config.customScanPaths);
  }
}
