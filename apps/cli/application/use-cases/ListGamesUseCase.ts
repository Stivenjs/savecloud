import type { ConfiguredGame } from "@cli/domain/entities/ConfiguredGame";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";

export type ListGamesOutput = readonly ConfiguredGame[];

/**
 * Lista todos los juegos configurados.
 */
export class ListGamesUseCase {
  constructor(private readonly configRepository: ConfigRepository) {}

  async execute(): Promise<ListGamesOutput> {
    const config = await this.configRepository.load();
    return config.games;
  }
}
