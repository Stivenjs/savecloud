import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { ClipStore } from "@infrastructure/clips/ClipStore";
import { DynamoDbClipStore } from "@infrastructure/clips/DynamoDbClipStore";
import { DynamoDbCloudInviteRepository } from "@infrastructure/persistence/DynamoDbCloudInviteRepository";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { DynamoDbGameInventoryRepository } from "@infrastructure/persistence/DynamoDbGameInventoryRepository";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbNotificationStore } from "@infrastructure/persistence/DynamoDbNotificationStore";
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

/** Construye adaptadores de almacenamiento compartidos por los entrypoints HTTP. */
export function createApiStores(input: ApiStoresFactoryInput) {
  const { s3, dynamo, bucketName, presignS3, tables } = input;
  const saveRepository = new S3SaveRepository(s3, bucketName, presignS3);
  const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName, presignS3);
  const shareTokenRepository = tables.shareTokens
    ? new DynamoDbShareTokenStore(dynamo, tables.shareTokens, s3, bucketName)
    : new ShareTokenS3(s3, bucketName);
  const clipRepository = tables.clips
    ? new DynamoDbClipStore(s3, bucketName, dynamo, tables.clips, presignS3)
    : new ClipStore(s3, bucketName, presignS3);
  const notificationRepository = tables.notifications
    ? new DynamoDbNotificationStore(dynamo, tables.notifications, s3, bucketName)
    : new S3NotificationStore(s3, bucketName);
  const s3CloudInviteFallback = new S3CloudInviteRepository(s3, bucketName);
  const cloudInviteRepository = tables.cloudInvites
    ? new DynamoDbCloudInviteRepository(dynamo, tables.cloudInvites, s3CloudInviteFallback)
    : s3CloudInviteFallback;
  const s3GameInventoryFallback = new S3GameInventoryRepository(s3, bucketName, cloudInviteRepository);
  const gameInventoryRepository = tables.gameInventory
    ? new DynamoDbGameInventoryRepository(dynamo, tables.gameInventory, cloudInviteRepository, s3GameInventoryFallback)
    : s3GameInventoryFallback;

  return {
    saveRepository,
    steamSeedRepository,
    shareTokenRepository,
    clipRepository,
    notificationRepository,
    cloudInviteRepository,
    gameInventoryRepository,
    gameStatRepository: tables.gameStats ? new DynamoDbGameStatRepository(dynamo, tables.gameStats) : undefined,
    saveFileIndexRepository: tables.saveFilesIndex
      ? new DynamoDbSaveFileIndexRepository(dynamo, tables.saveFilesIndex)
      : undefined,
    connectionRepository: tables.connections ? new DynamoDbConnectionRepository(dynamo, tables.connections) : undefined,
  };
}
