import type { ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import {
  createDynamoDbClient,
  ensureDynamoDbTablesExist,
  type DynamoDbTablesConfig,
} from "@infrastructure/factories/dynamoDbFactory";
import { createPresignS3Client, createS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { createS3EventQueueClient, enqueueS3Events, ensureS3EventQueue } from "@infrastructure/queue/s3EventQueue";
import { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";
import { startBunServer } from "@infrastructure/websocket/BunWebSocketServer";
import { ensurePostgresNotificationSchema } from "@infrastructure/persistence/PostgresNotificationStore";
import { ensurePostgresSaveFileIndexSchema } from "@infrastructure/persistence/PostgresSaveFileIndexRepository";
import { ensurePostgresCloudInviteSchema } from "@infrastructure/persistence/PostgresCloudInviteRepository";
import { ensurePostgresConnectionSchema } from "@infrastructure/persistence/PostgresConnectionRepository";
import { ensurePostgresGameInventorySchema } from "@infrastructure/persistence/PostgresGameInventoryRepository";
import { ensurePostgresGameStatSchema } from "@infrastructure/persistence/PostgresGameStatRepository";
import { ensurePostgresClipSchema } from "@infrastructure/clips/PostgresClipStore";
import { ensurePostgresShareTokenSchema } from "@infrastructure/share/PostgresShareTokenRepository";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";
import { validateRuntimeConfiguration } from "@interfaces/configuration/runtimeConfiguration";
import { buildApp } from "@interfaces/http/app";

/** Puerto predeterminado de la API HTTP. */
const DEFAULT_SERVER_PORT = 3000;

/** Dirección de red donde escucha el servidor. */
const DEFAULT_SERVER_HOST = "0.0.0.0";

/** Tamaño máximo aceptado por una solicitud de envío a SQS. */
const SQS_MAX_BATCH_SIZE = 10;

/** Nombres predeterminados para las tablas DynamoDB de entornos de desarrollo AWS. */
const DEFAULT_TABLE_NAMES = {
  gameStats: "savecloud-game-stats",
  saveFilesIndex: "savecloud-save-files-index",
  connections: "savecloud-connections",
  clips: "savecloud-clips",
  notifications: "savecloud-notifications",
  shareTokens: "savecloud-share-tokens",
  cloudInvites: "savecloud-cloud-invites",
  gameInventory: "savecloud-game-inventory",
} as const;

interface S3EventQueueConfiguration {
  client: ReturnType<typeof createS3EventQueueClient> | undefined;
  name: string | undefined;
  url: string | undefined;
}

/** Lee una variable opcional y elimina espacios en blanco laterales. */
function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** Indica si se configuró explícitamente un endpoint local de DynamoDB. */
function isDynamoDbLocal(): boolean {
  return optionalEnv("DYNAMODB_ENDPOINT") !== undefined;
}

/** Valida los secretos requeridos al ejecutar la API en modo de producción. */
function validateProductionConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;

  if (!optionalEnv("API_KEY")) {
    throw new Error("[bootstrap] API_KEY es obligatoria en producción; la API no puede iniciar sin autenticación.");
  }
  if (!optionalEnv("ACCESS_TOKEN_SECRET")) {
    throw new Error("[bootstrap] ACCESS_TOKEN_SECRET es obligatoria en producción para firmar sesiones de invitados.");
  }

  if (!isDynamoDbLocal()) validateRuntimeConfiguration("self-hosted");
}

/** Resuelve una tabla configurada explícitamente o su valor predeterminado local. */
function resolveTableName(
  environmentName: string,
  localDefault: string,
  useLocalDefaults: boolean
): string | undefined {
  const configuredName = optionalEnv(environmentName);
  if (configuredName) return configuredName;
  if (useLocalDefaults) return localDefault;
  return undefined;
}

/** Lee todos los nombres de tablas necesarios para construir los repositorios de la API. */
function readTableConfiguration(usePostgresStorage: boolean): DynamoDbTablesConfig {
  const useLocalDefaults = isDynamoDbLocal();

  return {
    gameStatsTable: usePostgresStorage
      ? undefined
      : resolveTableName("GAME_STATS_TABLE", DEFAULT_TABLE_NAMES.gameStats, useLocalDefaults),
    saveFilesIndexTable: usePostgresStorage
      ? undefined
      : resolveTableName("SAVE_FILES_INDEX_TABLE", DEFAULT_TABLE_NAMES.saveFilesIndex, useLocalDefaults),
    connectionsTable: usePostgresStorage
      ? undefined
      : resolveTableName("CONNECTIONS_TABLE", DEFAULT_TABLE_NAMES.connections, useLocalDefaults),
    clipsTable: usePostgresStorage
      ? undefined
      : resolveTableName("CLIPS_TABLE", DEFAULT_TABLE_NAMES.clips, useLocalDefaults),
    notificationsTable: usePostgresStorage
      ? undefined
      : resolveTableName("NOTIFICATIONS_TABLE", DEFAULT_TABLE_NAMES.notifications, useLocalDefaults),
    shareTokensTable: usePostgresStorage
      ? undefined
      : resolveTableName("SHARE_TOKENS_TABLE", DEFAULT_TABLE_NAMES.shareTokens, useLocalDefaults),
    cloudInvitesTable: usePostgresStorage
      ? undefined
      : resolveTableName("CLOUD_INVITES_TABLE", DEFAULT_TABLE_NAMES.cloudInvites, useLocalDefaults),
    gameInventoryTable: usePostgresStorage
      ? undefined
      : resolveTableName("GAME_INVENTORY_TABLE", DEFAULT_TABLE_NAMES.gameInventory, useLocalDefaults),
  };
}

/** Crea el cliente de eventos S3 cuando se configuró una cola. */
function createS3EventQueueConfiguration(): S3EventQueueConfiguration {
  const name = optionalEnv("S3_EVENT_QUEUE_NAME");
  const url = optionalEnv("S3_EVENT_QUEUE_URL");

  if (name && !url) {
    throw new Error("S3_EVENT_QUEUE_URL es obligatorio cuando se configura S3_EVENT_QUEUE_NAME.");
  }

  return {
    client: name ? createS3EventQueueClient() : undefined,
    name,
    url,
  };
}

/** Crea el procesador que publica eventos S3 en lotes dentro de la cola configurada. */
function createS3EventProcessor(
  queue: S3EventQueueConfiguration
): ((events: ProcessS3EventInput[]) => Promise<void>) | undefined {
  const { client, name, url } = queue;
  if (!client || !name || !url) return undefined;

  return async (events) => {
    for (let offset = 0; offset < events.length; offset += SQS_MAX_BATCH_SIZE) {
      const batch = events.slice(offset, offset + SQS_MAX_BATCH_SIZE);
      await enqueueS3Events(client, url, batch);
    }
  };
}

/**
 * Inicializa las dependencias y crea los esquemas de almacenamiento configurados.
 */
async function initializeStorage(
  database: ReturnType<typeof createDatabaseClient> | undefined,
  dynamoClient: ReturnType<typeof createDynamoDbClient> | undefined,
  tableConfiguration: DynamoDbTablesConfig,
  queue: S3EventQueueConfiguration
): Promise<void> {
  const initializationTasks: Promise<unknown>[] = [];

  if (dynamoClient) initializationTasks.push(ensureDynamoDbTablesExist(dynamoClient, tableConfiguration));

  if (database) {
    initializationTasks.push(
      Promise.all([
        ensurePostgresNotificationSchema(database),
        ensurePostgresSaveFileIndexSchema(database),
        ensurePostgresCloudInviteSchema(database),
        ensurePostgresConnectionSchema(database),
        ensurePostgresGameStatSchema(database),
        ensurePostgresGameInventorySchema(database),
        ensurePostgresClipSchema(database),
        ensurePostgresShareTokenSchema(database),
      ])
    );
  }

  if (queue.client && queue.name) {
    initializationTasks.push(ensureS3EventQueue(queue.client, queue.name));
  }

  await Promise.all(initializationTasks);

  if (database) {
    console.log("[SaveCloud API] PostgreSQL schemas verified.");
  }

  if (dynamoClient) console.log("[SaveCloud API] DynamoDB tables verified.");

  if (queue.client && queue.name) {
    console.log("[SaveCloud API] S3 event queue verified.");
  }
}

/** Inicia Fastify usando el servidor nativo de Bun o el listener de Fastify. */
async function startServer(
  app: Awaited<ReturnType<typeof buildApp>>,
  stores: ReturnType<typeof createApiStores>,
  webSocketNotifier: FastifyWebSocketNotifier
): Promise<void> {
  const port = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
  const host = DEFAULT_SERVER_HOST;
  const connectionRepository = stores.connectionRepository;
  const bunRuntime = typeof Bun !== "undefined";

  if (bunRuntime) {
    await startBunServer({
      port,
      host,
      app,
      connectionRepository,
      webSocketNotifier,
      accessSessionRepository: stores.accessSessionRepository,
    });
    return;
  }

  app.listen({ port, host }, (error, address) => {
    if (error) {
      console.error("[SaveCloud API] Error starting HTTP server:", error);
      process.exit(1);
    }
    console.log(`[SaveCloud API] Server listening on ${address}`);
  });
}

/** Construye la aplicación, inicializa los almacenes y arranca el servidor HTTP. */
async function main(): Promise<void> {
  validateProductionConfiguration();
  console.log("[SaveCloud API] Starting server initialization...");

  const bucketName = getBucketName();
  const databaseConfiguration = readDatabaseConfiguration();
  const database = databaseConfiguration ? createDatabaseClient(databaseConfiguration) : undefined;
  const localDynamoDb = isDynamoDbLocal();

  if (process.env.NODE_ENV === "production" && localDynamoDb && !database) {
    throw new Error("[bootstrap] DATABASE_URL o DATABASE_* son obligatorias para el almacenamiento SQL en Docker.");
  }

  const tableConfiguration = readTableConfiguration(database !== undefined);
  const queue = createS3EventQueueConfiguration();
  const hasDynamoTables = Object.values(tableConfiguration).some((tableName) => tableName !== undefined);
  const dynamoClient = hasDynamoTables ? createDynamoDbClient() : undefined;
  const s3 = createS3Client();
  const presignS3 = createPresignS3Client();
  const stores = createApiStores({
    s3,
    dynamo: dynamoClient,
    database,
    bucketName,
    presignS3,
    tables: {
      gameStats: tableConfiguration.gameStatsTable,
      saveFilesIndex: tableConfiguration.saveFilesIndexTable,
      connections: tableConfiguration.connectionsTable,
      clips: tableConfiguration.clipsTable,
      notifications: tableConfiguration.notificationsTable,
      shareTokens: tableConfiguration.shareTokensTable,
      cloudInvites: tableConfiguration.cloudInvitesTable,
      gameInventory: tableConfiguration.gameInventoryTable,
    },
  });

  try {
    await initializeStorage(database, dynamoClient, tableConfiguration, queue);
  } catch (error: unknown) {
    console.error("[SaveCloud API] Error verifying storage dependencies:", error);
    throw error;
  }

  const webSocketNotifier = new FastifyWebSocketNotifier(stores.connectionRepository);
  const app = await buildApp({
    ...stores,
    getActiveWebSocketConnectionCount: () => webSocketNotifier.getActiveConnectionCount(),
    webSocketNotifier,
    processS3Events: createS3EventProcessor(queue),
  });

  await startServer(app, stores, webSocketNotifier);
}

main().catch((error: unknown) => {
  console.error("[SaveCloud API] Fatal initialization error:", error);
  process.exit(1);
});
