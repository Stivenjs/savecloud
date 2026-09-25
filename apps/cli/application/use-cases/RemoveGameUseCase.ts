import type { Config } from "@cli/domain/entities/Config";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";

export interface RemoveGameInput {
  gameId: string;
  /** Si se indica, solo elimina esa ruta del juego; si queda sin rutas, elimina el juego. */
  path?: string;
}

export interface RemoveGameResult {
  removedGame: boolean;
  removedPath: boolean;
}

/**
 * Elimina un juego completo o una ruta específica de un juego configurado.
 */
export class RemoveGameUseCase {
  constructor(private readonly configRepository: ConfigRepository) {}

  async execute(input: RemoveGameInput): Promise<RemoveGameResult> {
    const config = await this.configRepository.load();
    const normalizedId = input.gameId.trim().toLowerCase();

    const existingIndex = config.games.findIndex((g) => g.id.toLowerCase() === normalizedId);

    if (existingIndex < 0) {
      throw new Error(`Game not found: ${input.gameId}`);
    }

    const existing = config.games[existingIndex];
    let result: RemoveGameResult;
    let newConfig: Config;

    if (input.path) {
      const filteredPaths = existing.paths.filter((p) => p !== input.path);
      if (filteredPaths.length === existing.paths.length) {
        throw new Error(`La ruta "${input.path}" no está en "${existing.id}"`);
      }

      if (filteredPaths.length === 0) {
        newConfig = {
          ...config,
          games: config.games.filter((_, i) => i !== existingIndex),
        };
        result = { removedGame: true, removedPath: true };
      } else {
        newConfig = {
          ...config,
          games: config.games.map((g, i) => (i === existingIndex ? { id: g.id, paths: filteredPaths } : g)),
        };
        result = { removedGame: false, removedPath: true };
      }
    } else {
      newConfig = {
        ...config,
        games: config.games.filter((_, i) => i !== existingIndex),
      };
      result = { removedGame: true, removedPath: false };
    }

    await this.configRepository.save(newConfig);
    return result;
  }
}
