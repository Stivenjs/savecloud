import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { buildApp } from "@interfaces/http/app";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { S3GameInventoryRepository } from "@infrastructure/persistence/S3GameInventoryRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { ApiGatewayNotifier } from "@infrastructure/websocket/ApiGatewayNotifier";
import { ClipStore } from "@infrastructure/clips/ClipStore";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[bootstrap] Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const bucketName = requireEnv("BUCKET_NAME");
const gameStatsTable = requireEnv("GAME_STATS_TABLE");
const saveFilesIndexTable = optionalEnv("SAVE_FILES_INDEX_TABLE");
const connectionsTable = optionalEnv("CONNECTIONS_TABLE");
const awsRegion = requireEnv("AWS_REGION");

const s3 = new S3Client({
  region: awsRegion,
  useAccelerateEndpoint: process.env.USE_ACCELERATE_ENDPOINT === "true",
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: 250 }),
    connectionTimeout: 300,
    socketTimeout: 3000,
  }),
});

const dynamoClient = new DynamoDBClient({
  region: awsRegion,
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: 100 }),
    connectionTimeout: 300,
    socketTimeout: 3000,
  }),
});

const saveRepository = new S3SaveRepository(s3, bucketName);
const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);
const clipStore = new ClipStore(s3, bucketName);
const notificationStore = new S3NotificationStore(s3, bucketName);
const cloudInviteRepository = new S3CloudInviteRepository(s3, bucketName);
const gameInventoryRepository = new S3GameInventoryRepository(s3, bucketName, cloudInviteRepository);
const gameStatRepository = new DynamoDbGameStatRepository(dynamoClient, gameStatsTable);
const saveFileIndexRepository = saveFilesIndexTable
  ? new DynamoDbSaveFileIndexRepository(dynamoClient, saveFilesIndexTable)
  : undefined;
const connectionRepository = connectionsTable
  ? new DynamoDbConnectionRepository(dynamoClient, connectionsTable)
  : undefined;

const wsEndpoint = optionalEnv("WS_ENDPOINT");
const webSocketNotifier =
  connectionRepository && wsEndpoint ? new ApiGatewayNotifier(wsEndpoint, connectionRepository) : undefined;

type Proxy = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

let proxyPromise: Promise<Proxy> | null = null;

function initProxy(): Promise<Proxy> {
  proxyPromise ??= (async (): Promise<Proxy> => {
    const start = Date.now();
    console.info("[bootstrap] Cold start — initializing app");

    const app = await buildApp({
      saveRepository,
      saveFileIndexRepository,
      steamSeedRepository,
      shareTokenStore,
      clipStore,
      notificationStore,
      cloudInviteRepository,
      gameInventoryRepository,
      gameStatRepository,
      connectionRepository,
      webSocketNotifier,
    });

    const proxy = awsLambdaFastify<APIGatewayProxyEvent>(app, {
      binaryMimeTypes: ["application/octet-stream"],
      callbackWaitsForEmptyEventLoop: false,
    });

    await app.ready();

    console.info(`[bootstrap] App ready in ${Date.now() - start}ms`);
    return proxy;
  })();

  return proxyPromise;
}

/**
 * Handler de Lambda: delega en Fastify vía @fastify/aws-lambda.
 * La app se construye una sola vez y se reutiliza entre invocaciones (warm start).
 */
export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  context.callbackWaitsForEmptyEventLoop = false;
  const proxy = await initProxy();
  return proxy(event, context);
}
