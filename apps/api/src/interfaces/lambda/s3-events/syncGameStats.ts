import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";

const GAME_STATS_TABLE = process.env.GAME_STATS_TABLE;
const SAVE_FILES_INDEX_TABLE = process.env.SAVE_FILES_INDEX_TABLE;

if (!GAME_STATS_TABLE) throw new Error("GAME_STATS_TABLE environment variable is missing");
if (!SAVE_FILES_INDEX_TABLE) throw new Error("SAVE_FILES_INDEX_TABLE environment variable is missing");

const dynamoClient = new DynamoDBClient();

const gameStatRepo = new DynamoDbGameStatRepository(dynamoClient, GAME_STATS_TABLE);
const saveFileIndexRepo = new DynamoDbSaveFileIndexRepository(dynamoClient, SAVE_FILES_INDEX_TABLE);

export const handler = async (event: any) => {
  const detailType: string | undefined = event.detailType ?? event["detail-type"];
  const eventTimeRaw: string | undefined = event.time;
  const eventTime = eventTimeRaw ? new Date(eventTimeRaw) : undefined;

  const detailObject = event.detail?.object;
  const s3Key: string | undefined = detailObject?.key;

  if (!s3Key) {
    return;
  }

  const parts = s3Key.split("/");
  if (parts.length < 2) {
    return;
  }

  const userId = parts[0];
  const gameId = parts[1];

  if (!userId || !gameId) return;

  const ignoredKeys = new Set([
    "share-tokens",
    "backups",
    "cloud-invites",
    "__config__",
    "notifications",
    "steam-seed",
    "cloud-invites-memberships",
  ]);
  if (ignoredKeys.has(userId) || ignoredKeys.has(gameId)) return;

  if (detailType === "Object Deleted") {
    const existing = await saveFileIndexRepo.getByObjectKey(userId, s3Key);
    if (!existing) return;

    const deletedSize = existing.size ?? 0;
    await saveFileIndexRepo.delete(userId, s3Key);

    await gameStatRepo.applyDelta({
      userId,
      gameId,
      deltaFileCount: -1,
      deltaSizeBytes: -deletedSize,
    });
  } else if (detailType === "Object Created") {
    const objectSize = typeof detailObject?.size === "number" ? detailObject.size : undefined;
    const existing = await saveFileIndexRepo.getByObjectKey(userId, s3Key);

    const previousSize = existing?.size ?? 0;
    const nextSize = objectSize ?? 0;
    const deltaFileCount = existing ? 0 : 1;
    const deltaSizeBytes = nextSize - previousSize;

    await saveFileIndexRepo.upsert({
      userId,
      gameId,
      objectKey: s3Key,
      size: objectSize,
      lastModified: eventTime,
    });

    await gameStatRepo.applyDelta({
      userId,
      gameId,
      deltaFileCount,
      deltaSizeBytes,
      lastModified: eventTime,
    });
  }
};
