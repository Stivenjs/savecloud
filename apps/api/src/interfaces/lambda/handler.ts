import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { buildApp } from "@interfaces/http/app";
import { ApiGatewayNotifier } from "@infrastructure/websocket/ApiGatewayNotifier";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { validateRuntimeConfiguration } from "@interfaces/configuration/runtimeConfiguration";

validateRuntimeConfiguration("lambda");

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
const clipsTable = optionalEnv("CLIPS_TABLE");
const notificationsTable = optionalEnv("NOTIFICATIONS_TABLE");
const shareTokensTable = optionalEnv("SHARE_TOKENS_TABLE");
const cloudInvitesTable = optionalEnv("CLOUD_INVITES_TABLE");
const gameInventoryTable = optionalEnv("GAME_INVENTORY_TABLE");
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

const stores = createApiStores({
  s3,
  dynamo: dynamoClient,
  bucketName,
  tables: {
    gameStats: gameStatsTable,
    saveFilesIndex: saveFilesIndexTable,
    connections: connectionsTable,
    clips: clipsTable,
    notifications: notificationsTable,
    shareTokens: shareTokensTable,
    cloudInvites: cloudInvitesTable,
    gameInventory: gameInventoryTable,
  },
});
const { connectionRepository } = stores;

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
      ...stores,
      connectionRepository,
      webSocketNotifier,
    });

    const proxy = awsLambdaFastify<APIGatewayProxyEvent>(app, {
      binaryMimeTypes: ["application/octet-stream", "application/gzip", "application/x-brotli", "image/*", "video/*"],
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
