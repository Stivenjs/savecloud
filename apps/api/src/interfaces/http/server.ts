import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { buildApp } from "@interfaces/http/app";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`[bootstrap-http] Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const bucketName = requiredEnv("BUCKET_NAME", "savecloud-saves-dev");
const awsRegion = requiredEnv("AWS_REGION", "us-east-2");
const gameStatsTable = optionalEnv("GAME_STATS_TABLE");
const saveFilesIndexTable = optionalEnv("SAVE_FILES_INDEX_TABLE");
const connectionsTable = optionalEnv("CONNECTIONS_TABLE");

const s3 = new S3Client({
  region: awsRegion,
  useAccelerateEndpoint: process.env.USE_ACCELERATE_ENDPOINT === "true",
});
const dynamoClient = new DynamoDBClient({ region: awsRegion });
const saveRepository = new S3SaveRepository(s3, bucketName);
const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);
const notificationStore = new S3NotificationStore(s3, bucketName);
const cloudInviteRepository = new S3CloudInviteRepository(s3, bucketName);
const gameStatRepository = gameStatsTable ? new DynamoDbGameStatRepository(dynamoClient, gameStatsTable) : undefined;
const saveFileIndexRepository = saveFilesIndexTable
  ? new DynamoDbSaveFileIndexRepository(dynamoClient, saveFilesIndexTable)
  : undefined;
const connectionRepository = connectionsTable
  ? new DynamoDbConnectionRepository(dynamoClient, connectionsTable)
  : undefined;

async function main() {
  const app = await buildApp({
    saveRepository,
    saveFileIndexRepository,
    steamSeedRepository,
    shareTokenStore,
    notificationStore,
    cloudInviteRepository,
    gameStatRepository,
    connectionRepository,
  });
  const port = Number(process.env.PORT) || 3000;
  app.listen({ port, host: "0.0.0.0" }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

main();
