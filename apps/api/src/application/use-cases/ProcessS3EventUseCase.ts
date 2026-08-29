import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";

export interface ProcessS3EventInput {
  detailType: "Object Created" | "Object Deleted";
  s3Key: string;
  size?: number;
  eventTime?: Date;
}

interface AggregatedGameDelta {
  userId: string;
  gameId: string;
  deltaFileCount: number;
  deltaSizeBytes: number;
  lastModified?: Date | null;
}

const IGNORED_SEGMENTS = new Set([
  "assets",
  "public",
  "static",
  "share-tokens",
  "backups",
  "cloud-invites",
  "cloud-invites-memberships",
  "cloud-invites-shared-games",
  "cloud-invites-member-hosts",
  "game-inventory",
  "notifications",
  "steam-seed",
  "steam-seed-manifest",
  "clips",
  "clips-meta",
  "__config__",
  "__torrent__",
  "__tmp__",
  "__temp__",
  "temp",
  "tmp",
]);

/**
 * Determina si una clave S3 corresponde a archivos de sistema, metadatos, clips o backups
 * que no deben ser indexados como archivos de guardado ni sumar en GameStats.
 */
function isIgnoredS3Key(s3Key: string, parts: string[]): boolean {
  if (parts.some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()))) {
    return true;
  }

  if (
    s3Key.includes("/backups/") ||
    s3Key.includes("/__torrent__/") ||
    s3Key.includes("/__config__/") ||
    s3Key.includes("/clips/") ||
    s3Key.includes("/clips-meta/")
  ) {
    return true;
  }

  return false;
}

/**
 * Caso de uso para procesar eventos S3 (Object Created / Object Deleted),
 * actualizando el índice de archivos guardados y las estadísticas por juego en DynamoDB.
 *
 * Incluye soporte para procesamiento por lotes (SQS batching / MinIO arrays) consolidando
 * en memoria los deltas por juego para reducir drásticamente las escrituras en DynamoDB.
 */
export class ProcessS3EventUseCase {
  constructor(
    private readonly saveFileIndexRepo: SaveFileIndexRepository,
    private readonly gameStatRepo: GameStatRepository
  ) {}

  /** Procesa un único evento S3 delegando en el procesamiento por lotes. */
  async execute(input: ProcessS3EventInput): Promise<void> {
    await this.executeBatch([input]);
  }

  /**
   * Procesa un lote de eventos S3 (típico de SQS o webhooks con múltiples archivos).
   *
   * 1. Indexa o elimina los archivos en SaveFilesIndexTable.
   * 2. Acumula en memoria los deltas de tamaño y conteo de archivos por (userId, gameId).
   * 3. Aplica un único applyDelta consolidado por juego a GameStatsTable.
   */
  async executeBatch(inputs: ProcessS3EventInput[]): Promise<void> {
    if (!inputs || inputs.length === 0) return;

    const gameDeltas = new Map<string, AggregatedGameDelta>();

    for (const input of inputs) {
      const { detailType, s3Key, size, eventTime } = input;
      if (!s3Key) continue;

      const parts = s3Key.split("/");
      if (parts.length < 2) continue;

      if (isIgnoredS3Key(s3Key, parts)) continue;

      const userId = parts[0];
      const gameId = parts[1];
      if (!userId || !gameId) continue;

      const gameKey = `${userId}:::${gameId}`;
      let deltaFileCount = 0;
      let deltaSizeBytes = 0;
      let targetTime = eventTime;

      if (detailType === "Object Deleted") {
        const existing = await this.saveFileIndexRepo.getByObjectKey(userId, s3Key);
        if (!existing) continue;

        const deletedSize = existing.size ?? 0;
        await this.saveFileIndexRepo.delete(userId, s3Key);

        deltaFileCount = -1;
        deltaSizeBytes = -deletedSize;
      } else if (detailType === "Object Created") {
        const existing = await this.saveFileIndexRepo.getByObjectKey(userId, s3Key);

        const previousSize = existing?.size ?? 0;
        const nextSize = size ?? 0;
        deltaFileCount = existing ? 0 : 1;
        deltaSizeBytes = nextSize - previousSize;

        await this.saveFileIndexRepo.upsert({
          userId,
          gameId,
          objectKey: s3Key,
          size,
          lastModified: eventTime,
        });
      }

      // Consolidar deltas en memoria por juego
      const current = gameDeltas.get(gameKey) ?? {
        userId,
        gameId,
        deltaFileCount: 0,
        deltaSizeBytes: 0,
        lastModified: null,
      };

      current.deltaFileCount += deltaFileCount;
      current.deltaSizeBytes += deltaSizeBytes;

      if (targetTime) {
        if (!current.lastModified || targetTime > current.lastModified) {
          current.lastModified = targetTime;
        }
      }

      gameDeltas.set(gameKey, current);
    }

    // Aplicar deltas consolidados a DynamoDB (1 llamada por juego único en el lote)
    const promises: Promise<void>[] = [];
    for (const delta of gameDeltas.values()) {
      if (delta.deltaFileCount !== 0 || delta.deltaSizeBytes !== 0 || delta.lastModified) {
        promises.push(this.gameStatRepo.applyDelta(delta));
      }
    }

    await Promise.all(promises);
  }
}
