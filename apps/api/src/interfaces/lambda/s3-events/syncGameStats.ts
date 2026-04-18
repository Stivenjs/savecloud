import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { SyncGameStatsUseCase } from "@application/use-cases/SyncGameStatsUseCase";

const GAME_STATS_TABLE = process.env.GAME_STATS_TABLE;
const SAVE_FILES_INDEX_TABLE = process.env.SAVE_FILES_INDEX_TABLE;
const BUCKET_NAME = process.env.BUCKET_NAME;

if (!GAME_STATS_TABLE) throw new Error("GAME_STATS_TABLE environment variable is missing");
if (!SAVE_FILES_INDEX_TABLE) throw new Error("SAVE_FILES_INDEX_TABLE environment variable is missing");
if (!BUCKET_NAME) throw new Error("BUCKET_NAME environment variable is missing");

const dynamoClient = new DynamoDBClient();
const s3Client = new S3Client();

const gameStatRepo = new DynamoDbGameStatRepository(dynamoClient, GAME_STATS_TABLE);
const saveFileIndexRepo = new DynamoDbSaveFileIndexRepository(dynamoClient, SAVE_FILES_INDEX_TABLE);
const saveRepo = new S3SaveRepository(s3Client, BUCKET_NAME);

const syncGameStatsUseCase = new SyncGameStatsUseCase(gameStatRepo, saveRepo);

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
    await saveFileIndexRepo.delete(userId, s3Key);
  } else if (detailType === "Object Created") {
    const objectSize = typeof detailObject?.size === "number" ? detailObject.size : undefined;
    await saveFileIndexRepo.upsert({
      userId,
      gameId,
      objectKey: s3Key,
      size: objectSize,
      lastModified: eventTime,
    });
  }

  await syncGameStatsUseCase.execute({ userId, gameId });
};
