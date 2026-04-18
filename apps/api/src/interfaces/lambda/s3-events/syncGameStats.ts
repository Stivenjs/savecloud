import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { SyncGameStatsUseCase } from "@application/use-cases/SyncGameStatsUseCase";

const GAME_STATS_TABLE = process.env.GAME_STATS_TABLE;
const BUCKET_NAME = process.env.BUCKET_NAME;

if (!GAME_STATS_TABLE) throw new Error("GAME_STATS_TABLE environment variable is missing");
if (!BUCKET_NAME) throw new Error("BUCKET_NAME environment variable is missing");

const dynamoClient = new DynamoDBClient();
const s3Client = new S3Client();

const gameStatRepo = new DynamoDbGameStatRepository(dynamoClient, GAME_STATS_TABLE);
const saveRepo = new S3SaveRepository(s3Client, BUCKET_NAME);

const syncGameStatsUseCase = new SyncGameStatsUseCase(gameStatRepo, saveRepo);

export const handler = async (event: any) => {
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

  await syncGameStatsUseCase.execute({ userId, gameId });
};
