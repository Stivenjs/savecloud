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
import { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";
import { createS3Client, createPresignS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { createDynamoDbClient, ensureDynamoDbTablesExist } from "@infrastructure/factories/dynamoDbFactory";
import { ClipStore } from "@infrastructure/clips/ClipStore";
import { startBunServer } from "@infrastructure/websocket/BunWebSocketServer";

/** Puerto por defecto para el servidor HTTP de Fastify */
const DEFAULT_SERVER_PORT = 3000;

/** Dirección de red por defecto para escuchar peticiones externas */
const DEFAULT_SERVER_HOST = "0.0.0.0";

/** Nombres de las tablas por defecto en entorno local/docker */
const DEFAULT_GAME_STATS_TABLE = "savecloud-game-stats";
const DEFAULT_SAVE_FILES_INDEX_TABLE = "savecloud-save-files-index";
const DEFAULT_CONNECTIONS_TABLE = "savecloud-connections";

/**
 * Obtiene el valor de una variable de entorno de forma opcional, recortando espacios en blanco.
 *
 * @param name - Nombre de la variable de entorno.
 * @returns El valor limpio o `undefined` si no existe o está vacía.
 */
function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const bucketName = getBucketName();
const gameStatsTable =
  optionalEnv("GAME_STATS_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_GAME_STATS_TABLE : undefined);
const saveFilesIndexTable =
  optionalEnv("SAVE_FILES_INDEX_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_SAVE_FILES_INDEX_TABLE : undefined);
const connectionsTable =
  optionalEnv("CONNECTIONS_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_CONNECTIONS_TABLE : undefined);

const s3 = createS3Client();
const presignS3 = createPresignS3Client();
const dynamoClient = createDynamoDbClient();

const saveRepository = new S3SaveRepository(s3, bucketName, presignS3);
const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName, presignS3);
const shareTokenStore = new ShareTokenS3(s3, bucketName);
const clipStore = new ClipStore(s3, bucketName, presignS3);
const notificationStore = new S3NotificationStore(s3, bucketName);
const cloudInviteRepository = new S3CloudInviteRepository(s3, bucketName);
const gameInventoryRepository = new S3GameInventoryRepository(s3, bucketName, cloudInviteRepository);

const gameStatRepository = gameStatsTable ? new DynamoDbGameStatRepository(dynamoClient, gameStatsTable) : undefined;
const saveFileIndexRepository = saveFilesIndexTable
  ? new DynamoDbSaveFileIndexRepository(dynamoClient, saveFilesIndexTable)
  : undefined;
const connectionRepository = connectionsTable
  ? new DynamoDbConnectionRepository(dynamoClient, connectionsTable)
  : undefined;

const webSocketNotifier = new FastifyWebSocketNotifier(connectionRepository);

/**
 * Función de arranque principal de la API HTTP de SaveCloud.
 *
 * Se encarga de:
 * 1. Inicializar y verificar las tablas en DynamoDB Local/AWS.
 * 2. Construir la aplicación Fastify con la inyección de dependencias necesaria.
 * 3. Iniciar el servidor de Bun o Fastify escuchando en el puerto configurado (`PORT` o 3000).
 */
async function main(): Promise<void> {
  console.log("[SaveCloud API] Starting server initialization...");

  try {
    await ensureDynamoDbTablesExist(dynamoClient, {
      gameStatsTable,
      saveFilesIndexTable,
      connectionsTable,
    });
    console.log("[SaveCloud API] DynamoDB tables verified.");
  } catch (err: unknown) {
    console.error("[SaveCloud API] Error verifying DynamoDB tables:", err);
  }

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

  const port = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
  const host = DEFAULT_SERVER_HOST;

  const isBun = typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

  if (isBun) {
    await startBunServer({
      port,
      host,
      app,
      connectionRepository,
      webSocketNotifier,
    });
  } else {
    app.listen({ port, host }, (err, address) => {
      if (err) {
        console.error("[SaveCloud API] Error starting HTTP server:", err);
        process.exit(1);
      }
      console.log(`[SaveCloud API] Server listening on ${address}`);
    });
  }

  if (process.env.ENABLE_SEED_WORKER === "true" || process.env.NODE_ENV !== "production") {
    const SEED_INTERVAL_MS = Number(process.env.SEED_INTERVAL_MS) || 5 * 60 * 1000;
    console.log(`[SaveCloud API] Background Steam Seed Worker active (interval: ${SEED_INTERVAL_MS / 1000}s)`);

    setTimeout(() => {
      import("@interfaces/lambda/steam-seed/handler")
        .then(({ handler }) => handler({}))
        .catch((workerErr) => {
          console.error("[SaveCloud API] Initial Steam Seed Worker tick error:", workerErr);
        });
    }, 10000);

    setInterval(() => {
      import("@interfaces/lambda/steam-seed/handler")
        .then(({ handler }) => handler({}))
        .catch((workerErr) => {
          console.error("[SaveCloud API] Periodic Steam Seed Worker tick error:", workerErr);
        });
    }, SEED_INTERVAL_MS);
  }
}

main().catch((err: unknown) => {
  console.error("[SaveCloud API] Fatal initialization error:", err);
  process.exit(1);
});
