/**
 * Composition root del CLI: crea infraestructura y casos de uso.
 * Todas las dependencias se inyectan a través de CliDeps.
 */
import { AddGameUseCase } from "@cli/application/use-cases/AddGameUseCase";
import { GetConfigPathUseCase } from "@cli/application/use-cases/GetConfigPathUseCase";
import { GetConfigUseCase } from "@cli/application/use-cases/GetConfigUseCase";
import { ListGamesUseCase } from "@cli/application/use-cases/ListGamesUseCase";
import { RemoveGameUseCase } from "@cli/application/use-cases/RemoveGameUseCase";
import { ScanForPathCandidatesUseCase } from "@cli/application/use-cases/ScanForPathCandidatesUseCase";
import { FileConfigRepository } from "@cli/infrastructure/FileConfigRepository";
import { FileSystemPathScanner } from "@cli/infrastructure/FileSystemPathScanner";

export interface CliDeps {
  addGameUseCase: AddGameUseCase;
  removeGameUseCase: RemoveGameUseCase;
  listGamesUseCase: ListGamesUseCase;
  getConfigPathUseCase: GetConfigPathUseCase;
  getConfigUseCase: GetConfigUseCase;
  scanForPathCandidatesUseCase: ScanForPathCandidatesUseCase;
}

export function createContainer(): CliDeps {
  const configRepository = new FileConfigRepository();
  const pathScanner = new FileSystemPathScanner();
  return {
    addGameUseCase: new AddGameUseCase(configRepository),
    removeGameUseCase: new RemoveGameUseCase(configRepository),
    listGamesUseCase: new ListGamesUseCase(configRepository),
    getConfigPathUseCase: new GetConfigPathUseCase(configRepository),
    getConfigUseCase: new GetConfigUseCase(configRepository),
    scanForPathCandidatesUseCase: new ScanForPathCandidatesUseCase(pathScanner, configRepository),
  };
}
