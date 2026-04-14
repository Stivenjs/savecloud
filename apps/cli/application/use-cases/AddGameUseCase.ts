import type { Config } from "@cli/domain/entities/Config";
import type { ConfiguredGame } from "@cli/domain/entities/ConfiguredGame";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";

export interface AddGameInput {
  gameId: string;
  path: string;
  /** Etiqueta de origen/edición (opcional, solo informativa). */
  editionLabel?: string;
  /** URL de descarga o página de la edición (opcional). */
  sourceUrl?: string;
}

/**
 * Añade un juego al config, o añade una ruta si el juego ya existe.
 * No conoce disco ni JSON; solo orquesta el repositorio.
 */
export class AddGameUseCase {
  constructor(private readonly configRepository: ConfigRepository) {}

  async execute(input: AddGameInput): Promise<void> {
    const config = await this.configRepository.load();
    const normalizedId = input.gameId.trim().toLowerCase();
    const normalizedPath = input.path.trim();
    const normalizedEdition =
      input.editionLabel?.trim() && input.editionLabel.trim().length > 0 ? input.editionLabel.trim() : undefined;
    const normalizedSourceUrl =
      input.sourceUrl?.trim() && input.sourceUrl.trim().length > 0 ? input.sourceUrl.trim() : undefined;

    if (!normalizedId || !normalizedPath) {
      throw new Error("gameId y path son obligatorios");
    }

    const existingIndex = config.games.findIndex((g) => g.id.toLowerCase() === normalizedId);
    const existing = existingIndex >= 0 ? config.games[existingIndex] : null;

    let newGames: ConfiguredGame[];

    if (existing) {
      const paths = [...existing.paths];
      if (!paths.includes(normalizedPath)) {
        paths.push(normalizedPath);
      }
      const updated: ConfiguredGame = {
        ...existing,
        paths,
        ...(normalizedEdition ? { editionLabel: normalizedEdition } : {}),
        ...(normalizedSourceUrl ? { sourceUrl: normalizedSourceUrl } : {}),
      };
      newGames = config.games.map((g, i) => (i === existingIndex ? updated : g));
    } else {
      let created: ConfiguredGame = {
        id: normalizedId,
        paths: [normalizedPath],
      };
      if (normalizedEdition) {
        created = { ...created, editionLabel: normalizedEdition };
      }
      if (normalizedSourceUrl) {
        created = { ...created, sourceUrl: normalizedSourceUrl };
      }
      newGames = [...config.games, created];
    }

    const newConfig: Config = {
      ...config,
      games: newGames,
    };
    await this.configRepository.save(newConfig);
  }
}
