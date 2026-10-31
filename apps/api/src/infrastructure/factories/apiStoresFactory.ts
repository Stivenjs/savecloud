import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import type { SQL } from "bun";
import { ClipStore } from "@infrastructure/clips/ClipStore";
import { DynamoDbClipStore } from "@infrastructure/clips/DynamoDbClipStore";
import { DynamoDbCloudInviteRepository } from "@infrastructure/persistence/DynamoDbCloudInviteRepository";
import { DynamoDbAccessSessionRepository } from "@infrastructure/persistence/DynamoDbAccessSessionRepository";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { DynamoDbGameInventoryRepository } from "@infrastructure/persistence/DynamoDbGameInventoryRepository";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbNotificationStore } from "@infrastructure/persistence/DynamoDbNotificationStore";
import { PostgresNotificationStore } from "@infrastructure/persistence/PostgresNotificationStore";
import { PostgresSaveFileIndexRepository } from "@infrastructure/persistence/PostgresSaveFileIndexRepository";
import { PostgresCloudInviteRepository } from "@infrastructure/persistence/PostgresCloudInviteRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { S3GameInventoryRepository } from "@infrastructure/persistence/S3GameInventoryRepository";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { DynamoDbShareTokenStore } from "@infrastructure/share/DynamoDbShareTokenStore";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

export interface ApiStoresFactoryInput {
  s3: S3Client;
  dynamo: DynamoDBClient;
  bucketName: string;
  presignS3?: S3Client;
  /** Pool SQL compartido por los adaptadores PostgreSQL que se habiliten en la API. */
  database?: SQL;
  /** Nombres de tablas DynamoDB; algunas ausencias desactivan el adaptador o usan su fallback S3. */
  tables: {
    gameStats?: string;
    saveFilesIndex?: string;
    connections?: string;
    clips?: string;
    notifications?: string;
    shareTokens?: string;
    cloudInvites?: string;
    gameInventory?: string;
  };
}

/** Crea el repositorio de tokens compartidos según la tabla configurada. */
function createShareTokenRepository(input: ApiStoresFactoryInput) {
  const { dynamo, s3, bucketName, tables } = input;
  const tableName = tables.shareTokens;

  if (!tableName) return new ShareTokenS3(s3, bucketName);
  return new DynamoDbShareTokenStore(dynamo, tableName, s3, bucketName);
}

/** Crea el repositorio de clips según la tabla configurada. */
function createClipRepository(input: ApiStoresFactoryInput) {
  const { s3, dynamo, bucketName, presignS3, tables } = input;
  const tableName = tables.clips;

  if (!tableName) return new ClipStore(s3, bucketName, presignS3);
  return new DynamoDbClipStore(s3, bucketName, dynamo, tableName, presignS3);
}

/** Crea el repositorio de notificaciones y prioriza PostgreSQL si está configurado. */
function createNotificationRepository(input: ApiStoresFactoryInput) {
  const { s3, dynamo, bucketName, database, tables } = input;

  if (database) return new PostgresNotificationStore(database);

  const tableName = tables.notifications;
  if (tableName) return new DynamoDbNotificationStore(dynamo, tableName, s3, bucketName);
  return new S3NotificationStore(s3, bucketName);
}

/** Crea el índice de archivos en PostgreSQL o DynamoDB según el almacén configurado. */
function createSaveFileIndexRepository(input: ApiStoresFactoryInput) {
  const { database, dynamo, tables } = input;

  if (database) return new PostgresSaveFileIndexRepository(database);
  return createOptionalTableRepository(
    tables.saveFilesIndex,
    (tableName) => new DynamoDbSaveFileIndexRepository(dynamo, tableName)
  );
}

/** Crea el repositorio de invitaciones y su alternativa respaldada por S3. */
function createCloudInviteRepository(input: ApiStoresFactoryInput) {
  const { s3, dynamo, bucketName, database, tables } = input;
  const fallback = new S3CloudInviteRepository(s3, bucketName);
  if (database) return new PostgresCloudInviteRepository(database, fallback);
  const tableName = tables.cloudInvites;

  if (!tableName) return fallback;
  return new DynamoDbCloudInviteRepository(dynamo, tableName, fallback);
}

/** Crea el repositorio de inventario con una alternativa S3 vinculada a invitaciones. */
function createGameInventoryRepository(
  input: ApiStoresFactoryInput,
  cloudInviteRepository: ReturnType<typeof createCloudInviteRepository>
) {
  const { s3, dynamo, bucketName, tables } = input;
  const fallback = new S3GameInventoryRepository(s3, bucketName, cloudInviteRepository);
  const tableName = tables.gameInventory;

  if (!tableName) return fallback;
  return new DynamoDbGameInventoryRepository(dynamo, tableName, cloudInviteRepository, fallback);
}

/** Crea un repositorio basado en tabla solo cuando se configuró su nombre. */
function createOptionalTableRepository<T>(
  tableName: string | undefined,
  createRepository: (tableName: string) => T
): T | undefined {
  if (!tableName) return undefined;
  return createRepository(tableName);
}

/** Construye adaptadores de almacenamiento compartidos por los entrypoints HTTP. */
export function createApiStores(input: ApiStoresFactoryInput) {
  const { s3, dynamo, bucketName, presignS3, database, tables } = input;
  const saveRepository = new S3SaveRepository(s3, bucketName, presignS3);
  const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName, presignS3);
  const shareTokenRepository = createShareTokenRepository(input);
  const clipRepository = createClipRepository(input);
  const notificationRepository = createNotificationRepository(input);
  const cloudInviteRepository = createCloudInviteRepository(input);
  const gameInventoryRepository = createGameInventoryRepository(input, cloudInviteRepository);

  return {
    saveRepository,
    steamSeedRepository,
    shareTokenRepository,
    clipRepository,
    notificationRepository,
    cloudInviteRepository,
    accessSessionRepository: database
      ? new PostgresCloudInviteRepository(database)
      : createOptionalTableRepository(
          tables.cloudInvites,
          (tableName) => new DynamoDbAccessSessionRepository(dynamo, tableName)
        ),
    gameInventoryRepository,
    gameStatRepository: createOptionalTableRepository(
      tables.gameStats,
      (tableName) => new DynamoDbGameStatRepository(dynamo, tableName)
    ),
    saveFileIndexRepository: createSaveFileIndexRepository(input),
    connectionRepository: createOptionalTableRepository(
      tables.connections,
      (tableName) => new DynamoDbConnectionRepository(dynamo, tableName)
    ),
  };
}
