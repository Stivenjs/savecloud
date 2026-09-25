import type { GameStatRepository } from "@domain/ports/GameStatRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { GameStat } from "@domain/entities/GameStat";

export interface SyncGameStatsInput {
  /** Identificador de usuario o scope de cloud invitado (Ej: `host::member::guest`) */
  userId: string;
  /** Identificador del juego modificado (Ej: `steam_app_123`) */
  gameId: string;
}

/**
 * Caso de uso: Sincroniza asíncronamente las estadísticas de un juego en DynamoDB.
 * Es disparado internamente mediante EventBridge cada vez que un archivo en S3 sufre un
 * `ObjectCreated` (Puts, MultiParts) o `ObjectDeleted`. Garantiza la consistencia
 * eventual y el alto rendimiento (O(1)) de la lectura posterior.
 */
export class SyncGameStatsUseCase {
  constructor(
    private readonly gameStatRepository: GameStatRepository,
    private readonly saveRepository: SaveRepository
  ) {}

  async execute(input: SyncGameStatsInput): Promise<void> {
    const { userId, gameId } = input;

    const saves = await this.saveRepository.listByUserAndGame(userId, gameId);

    if (saves.length === 0) {
      await this.gameStatRepository.delete(userId, gameId);
      return;
    }

    let totalSizeBytes = 0;
    let latestModified: Date | null = null;

    for (const save of saves) {
      totalSizeBytes += save.size ?? 0;
      if (save.lastModified) {
        if (!latestModified || save.lastModified > latestModified) {
          latestModified = save.lastModified;
        }
      }
    }

    const stat: GameStat = {
      userId,
      gameId,
      fileCount: saves.length,
      totalSizeBytes,
      lastModified: latestModified,
    };

    await this.gameStatRepository.save(stat);
  }
}
