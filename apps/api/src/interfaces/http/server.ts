import { buildApp } from "@interfaces/http/app";
import { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";
import { createS3Client, createPresignS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { createDynamoDbClient, ensureDynamoDbTablesExist } from "@infrastructure/factories/dynamoDbFactory";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { startBunServer } from "@infrastructure/websocket/BunWebSocketServer";
import { validateRuntimeConfiguration } from "@interfaces/configuration/runtimeConfiguration";
import { createS3EventQueueClient, enqueueS3Events, ensureS3EventQueue } from "@infrastructure/queue/s3EventQueue";

/** Puerto por defecto para el servidor HTTP de Fastify */
const DEFAULT_SERVER_PORT = 3000;

/** Dirección de red por defecto para escuchar peticiones externas */
const DEFAULT_SERVER_HOST = "0.0.0.0";

/** Nombres de las tablas por defecto en entorno local/docker */
const DEFAULT_GAME_STATS_TABLE = "savecloud-game-stats";
const DEFAULT_SAVE_FILES_INDEX_TABLE = "savecloud-save-files-index";
const DEFAULT_CONNECTIONS_TABLE = "savecloud-connections";
const DEFAULT_CLIPS_TABLE = "savecloud-clips";
const DEFAULT_NOTIFICATIONS_TABLE = "savecloud-notifications";
const DEFAULT_SHARE_TOKENS_TABLE = "savecloud-share-tokens";
const DEFAULT_CLOUD_INVITES_TABLE = "savecloud-cloud-invites";
const DEFAULT_GAME_INVENTORY_TABLE = "savecloud-game-inventory";
const SQS_MAX_BATCH_SIZE = 10;

if (process.env.NODE_ENV === "production") {
  if (!process.env.API_KEY?.trim()) {
    throw new Error("[bootstrap] API_KEY es obligatoria en producción; la API no puede iniciar sin autenticación.");
  }
  if (!process.env.ACCESS_TOKEN_SECRET?.trim()) {
    throw new Error("[bootstrap] ACCESS_TOKEN_SECRET es obligatoria en producción para firmar sesiones de invitados.");
  }

  // Las instalaciones con DynamoDB local (por ejemplo, Docker) también deben
  // proteger sus rutas. La validación completa solo aplica al despliegue sin
  // endpoint local, donde se esperan las variables de producción de AWS.
  if (!process.env.DYNAMODB_ENDPOINT?.trim()) validateRuntimeConfiguration("self-hosted");
}

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
const clipsTable = optionalEnv("CLIPS_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_CLIPS_TABLE : undefined);
const notificationsTable =
  optionalEnv("NOTIFICATIONS_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_NOTIFICATIONS_TABLE : undefined);
const shareTokensTable =
  optionalEnv("SHARE_TOKENS_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_SHARE_TOKENS_TABLE : undefined);
const cloudInvitesTable =
  optionalEnv("CLOUD_INVITES_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_CLOUD_INVITES_TABLE : undefined);
const gameInventoryTable =
  optionalEnv("GAME_INVENTORY_TABLE") || (process.env.DYNAMODB_ENDPOINT ? DEFAULT_GAME_INVENTORY_TABLE : undefined);

const s3 = createS3Client();
const presignS3 = createPresignS3Client();
const dynamoClient = createDynamoDbClient();

const stores = createApiStores({
  s3,
  dynamo: dynamoClient,
  bucketName,
  presignS3,
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

const webSocketNotifier = new FastifyWebSocketNotifier(connectionRepository);
const s3EventQueueName = optionalEnv("S3_EVENT_QUEUE_NAME");
const s3EventQueueClient = s3EventQueueName ? createS3EventQueueClient() : undefined;
const s3EventQueueUrl = optionalEnv("S3_EVENT_QUEUE_URL");

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
    if (s3EventQueueClient && s3EventQueueName) {
      if (!s3EventQueueUrl)
        throw new Error("S3_EVENT_QUEUE_URL es obligatorio cuando se configura S3_EVENT_QUEUE_NAME.");
      await ensureS3EventQueue(s3EventQueueClient, s3EventQueueName);
    }
    await ensureDynamoDbTablesExist(dynamoClient, {
      gameStatsTable,
      saveFilesIndexTable,
      connectionsTable,
      clipsTable,
      notificationsTable,
      shareTokensTable,
      cloudInvitesTable,
      gameInventoryTable,
    });
    console.log("[SaveCloud API] DynamoDB tables verified.");
  } catch (err: unknown) {
    console.error("[SaveCloud API] Error verifying DynamoDB tables:", err);
    throw err;
  }

  const app = await buildApp({
    ...stores,
    connectionRepository,
    webSocketNotifier,
    getActiveWebSocketConnectionCount: () => webSocketNotifier.getActiveConnectionCount(),
    processS3Events:
      s3EventQueueClient && s3EventQueueName
        ? async (events) => {
            for (let offset = 0; offset < events.length; offset += SQS_MAX_BATCH_SIZE) {
              await enqueueS3Events(
                s3EventQueueClient,
                s3EventQueueUrl!,
                events.slice(offset, offset + SQS_MAX_BATCH_SIZE)
              );
            }
          }
        : undefined,
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
      accessSessionRepository: stores.accessSessionRepository,
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
}

main().catch((err: unknown) => {
  console.error("[SaveCloud API] Fatal initialization error:", err);
  process.exit(1);
});
