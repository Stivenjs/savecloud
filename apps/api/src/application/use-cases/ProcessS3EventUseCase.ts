import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";

export interface ProcessS3EventInput {
  detailType: "Object Created" | "Object Deleted";
  s3Key: string;
  size?: number;
  eventTime?: Date;
}

const IGNORED_KEYS = new Set([
  "share-tokens",
  "backups",
  "cloud-invites",
  "__config__",
  "notifications",
  "steam-seed",
  "cloud-invites-memberships",
  "cloud-invites-shared-games",
  "cloud-invites-member-hosts",
  "game-inventory",
]);

/**
 * Caso de uso para procesar eventos S3 (Object Created / Object Deleted),
 * actualizando el índice de archivos guardados y las estadísticas por juego en DynamoDB.
 *
 * Compatible tanto con AWS EventBridge (Lambda) como con notificaciones MinIO (Docker).
 */
export class ProcessS3EventUseCase {
  constructor(
    private readonly saveFileIndexRepo: SaveFileIndexRepository,
    private readonly gameStatRepo: GameStatRepository
  ) {}

  async execute(input: ProcessS3EventInput): Promise<void> {
    const { detailType, s3Key, size, eventTime } = input;
    if (!s3Key) return;

    const parts = s3Key.split("/");
    if (parts.length < 2) return;

    const userId = parts[0];
    const gameId = parts[1];
    if (!userId || !gameId) return;

    if (IGNORED_KEYS.has(userId) || IGNORED_KEYS.has(gameId)) return;

    if (detailType === "Object Deleted") {
      const existing = await this.saveFileIndexRepo.getByObjectKey(userId, s3Key);
      if (!existing) return;

      const deletedSize = existing.size ?? 0;
      await this.saveFileIndexRepo.delete(userId, s3Key);

      await this.gameStatRepo.applyDelta({
        userId,
        gameId,
        deltaFileCount: -1,
        deltaSizeBytes: -deletedSize,
      });
    } else if (detailType === "Object Created") {
      const existing = await this.saveFileIndexRepo.getByObjectKey(userId, s3Key);

      const previousSize = existing?.size ?? 0;
      const nextSize = size ?? 0;
      const deltaFileCount = existing ? 0 : 1;
      const deltaSizeBytes = nextSize - previousSize;

      await this.saveFileIndexRepo.upsert({
        userId,
        gameId,
        objectKey: s3Key,
        size,
        lastModified: eventTime,
      });

      await this.gameStatRepo.applyDelta({
        userId,
        gameId,
        deltaFileCount,
        deltaSizeBytes,
        lastModified: eventTime,
      });
    }
  }
}
