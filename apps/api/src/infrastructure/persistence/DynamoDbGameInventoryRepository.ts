/**
 * @fileoverview Repositorio de inventario de dispositivos y sesiones de transferencia respaldado por DynamoDB.
 *
 * Implementa GameInventoryRepository con indexación por juego, soporte de TTL nativo para sesiones
 * temporales de streaming y fallback transparente a S3.
 *
 * @module infrastructure/persistence/DynamoDbGameInventoryRepository
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DeviceInventoryRecord, GameInventoryEntry, GameProviderDevice } from "@domain/entities/GameInventory";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type {
  GameInventoryRepository,
  PublishDeviceInventoryInput,
  TransferSessionRecord,
} from "@domain/ports/GameInventoryRepository";
import type { S3GameInventoryRepository } from "./S3GameInventoryRepository";

/**
 * Registro de dispositivo en DynamoDB.
 */
interface DeviceDbRecord {
  pk: string;
  sk: string;
  entityType: "DEVICE";
  deviceId: string;
  userId: string;
  deviceName: string;
  manifestVersion: number;
  contentHash: string;
  updatedAt: string;
  sharingEnabled: boolean;
  lastSeenAt?: string;
  appVersion?: string;
  games: GameInventoryEntry[];
}

/**
 * Registro de proveedor de juego en DynamoDB.
 */
interface GameProviderDbRecord {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "GAME_PROVIDER";
  hostUserId: string;
  gameKey: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  totalBytes: number;
  payloadKind: string;
  manifestHash: string;
  verifiedAt: string;
  lastSeenAt?: string;
  files?: GameProviderDevice["files"];
}

/**
 * Registro de sesión de transferencia en DynamoDB.
 */
interface TransferSessionDbRecord {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "TRANSFER_SESSION";
  sessionId: string;
  token: string;
  requesterUserId: string;
  targetUserId: string;
  targetDeviceId: string;
  gameKey: string;
  manifestHash: string;
  expiresAt: string;
  expiresAtEpoch: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Implementación de GameInventoryRepository sobre Amazon DynamoDB.
 */
export class DynamoDbGameInventoryRepository implements GameInventoryRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    dynamoClient: DynamoDBClient,
    private readonly tableName: string,
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly s3Fallback?: S3GameInventoryRepository
  ) {
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private async resolveHostUserIds(userId: string): Promise<string[]> {
    const hosts = new Set<string>([userId]);
    try {
      const asMember = await this.cloudInviteRepository.listMembershipsForMember(userId);
      for (const m of asMember) {
        if (m.active) hosts.add(m.hostUserId);
      }
      const asHost = await this.cloudInviteRepository.listMembershipsForHost(userId);
      for (const m of asHost) {
        if (m.active) hosts.add(userId);
      }
    } catch (err) {
      console.warn("[DynamoDbGameInventoryRepository] Error resolviendo hosts:", err);
    }
    return [...hosts];
  }

  /**
   * Obtiene el registro de inventario de un dispositivo.
   */
  async getDeviceRecord(userId: string, deviceId: string): Promise<DeviceInventoryRecord | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `USER#${userId.trim()}`,
          sk: `DEVICE#${deviceId.trim()}`,
        },
      })
    );

    if (res.Item) {
      const item = res.Item as DeviceDbRecord;
      return {
        deviceId: item.deviceId,
        userId: item.userId,
        deviceName: item.deviceName,
        manifestVersion: item.manifestVersion,
        contentHash: item.contentHash,
        updatedAt: item.updatedAt,
        sharingEnabled: item.sharingEnabled,
        lastSeenAt: item.lastSeenAt,
        appVersion: item.appVersion,
        games: item.games || [],
      };
    }

    if (this.s3Fallback) {
      return this.s3Fallback.getDeviceRecord(userId, deviceId);
    }

    return null;
  }

  /**
   * Publica o actualiza el catálogo de juegos de un dispositivo e indexa sus proveedores.
   */
  async putDeviceInventory(input: PublishDeviceInventoryInput): Promise<void> {
    const verified = input.games.filter((g) => g.status === "verified");
    const previous = await this.getDeviceRecord(input.userId, input.deviceId);
    const previousKeys = new Set(previous?.games.map((g) => g.gameKey) ?? []);

    const now = nowIso();
    const record: DeviceDbRecord = {
      pk: `USER#${input.userId.trim()}`,
      sk: `DEVICE#${input.deviceId.trim()}`,
      entityType: "DEVICE",
      deviceId: input.deviceId,
      userId: input.userId,
      deviceName: input.deviceName,
      manifestVersion: input.manifestVersion,
      contentHash: input.contentHash,
      updatedAt: input.updatedAt,
      sharingEnabled: input.sharingEnabled,
      lastSeenAt: now,
      games: verified,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );

    const hostIds = await this.resolveHostUserIds(input.userId);
    const newKeys = new Set(verified.map((g) => g.gameKey));

    // Eliminar índices de juegos que ya no existen
    for (const oldKey of previousKeys) {
      if (!newKeys.has(oldKey)) {
        for (const hostId of hostIds) {
          await this.removeDeviceFromIndex(hostId, oldKey, input.userId, input.deviceId);
        }
      }
    }

    if (!input.sharingEnabled) {
      for (const key of newKeys) {
        for (const hostId of hostIds) {
          await this.removeDeviceFromIndex(hostId, key, input.userId, input.deviceId);
        }
      }
      return;
    }

    // Agregar / actualizar índices de juegos disponibles
    for (const game of verified) {
      for (const hostId of hostIds) {
        await this.addDeviceToIndex(hostId, record, game);
      }
    }
  }

  private async addDeviceToIndex(hostUserId: string, record: DeviceDbRecord, game: GameInventoryEntry): Promise<void> {
    const item: GameProviderDbRecord = {
      pk: `HOST#${hostUserId.trim()}`,
      sk: `GAME#${game.gameKey.trim()}#DEVICE#${record.deviceId.trim()}`,
      gsi1pk: `GAME#${game.gameKey.trim()}`,
      gsi1sk: `HOST#${hostUserId.trim()}#DEVICE#${record.deviceId.trim()}`,
      entityType: "GAME_PROVIDER",
      hostUserId: hostUserId.trim(),
      gameKey: game.gameKey.trim(),
      userId: record.userId,
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      totalBytes: game.totalBytes,
      payloadKind: game.payloadKind,
      manifestHash: game.manifestHash,
      verifiedAt: game.verifiedAt,
      lastSeenAt: record.lastSeenAt,
      files: game.files,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  private async removeDeviceFromIndex(
    hostUserId: string,
    gameKey: string,
    _userId: string,
    deviceId: string
  ): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `HOST#${hostUserId.trim()}`,
          sk: `GAME#${gameKey.trim()}#DEVICE#${deviceId.trim()}`,
        },
      })
    );
  }

  /**
   * Elimina el inventario de un dispositivo y sus índices.
   */
  async deleteDeviceInventory(userId: string, deviceId: string): Promise<void> {
    const previous = await this.getDeviceRecord(userId, deviceId);
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `USER#${userId.trim()}`,
          sk: `DEVICE#${deviceId.trim()}`,
        },
      })
    );

    if (!previous) return;

    const hostIds = await this.resolveHostUserIds(userId);
    for (const game of previous.games) {
      for (const hostId of hostIds) {
        await this.removeDeviceFromIndex(hostId, game.gameKey, userId, deviceId);
      }
    }
  }

  /**
   * Actualiza la fecha de último contacto (heartbeat) y versión del cliente.
   */
  async recordHeartbeat(userId: string, deviceId: string, appVersion?: string): Promise<void> {
    const now = nowIso();
    const updateExpr = appVersion?.trim() ? "SET lastSeenAt = :now, appVersion = :ver" : "SET lastSeenAt = :now";

    const exprValues: Record<string, unknown> = { ":now": now };
    if (appVersion?.trim()) {
      exprValues[":ver"] = appVersion.trim();
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `USER#${userId.trim()}`,
          sk: `DEVICE#${deviceId.trim()}`,
        },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      })
    );
  }

  /**
   * Lista los dispositivos que ofrecen un juego específico para un host.
   */
  async listProvidersForGame(
    hostUserId: string,
    gameKey: string,
    excludeUserId?: string
  ): Promise<GameProviderDevice[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :hostPk AND begins_with(sk, :gamePrefix)",
        ExpressionAttributeValues: {
          ":hostPk": `HOST#${hostUserId.trim()}`,
          ":gamePrefix": `GAME#${gameKey.trim()}#DEVICE#`,
        },
      })
    );

    const providers: GameProviderDevice[] = [];
    if (res.Items && res.Items.length > 0) {
      for (const raw of res.Items) {
        const item = raw as GameProviderDbRecord;
        if (!excludeUserId || item.userId !== excludeUserId) {
          providers.push({
            userId: item.userId,
            deviceId: item.deviceId,
            deviceName: item.deviceName,
            totalBytes: item.totalBytes,
            payloadKind: item.payloadKind,
            manifestHash: item.manifestHash,
            verifiedAt: item.verifiedAt,
            lastSeenAt: item.lastSeenAt,
            files: item.files,
          });
        }
      }
      return providers;
    }

    if (this.s3Fallback) {
      return this.s3Fallback.listProvidersForGame(hostUserId, gameKey, excludeUserId);
    }

    return [];
  }

  /**
   * Registra una sesión de transferencia con TTL nativo de expiración.
   */
  async putTransferSession(record: TransferSessionRecord): Promise<void> {
    const expiresAtDate = new Date(record.expiresAt);
    const expiresAtEpoch = Math.floor(expiresAtDate.getTime() / 1000);

    const item: TransferSessionDbRecord = {
      pk: `SESSION#${record.sessionId.trim()}`,
      sk: "METADATA",
      gsi1pk: `TARGET_DEVICE#${record.targetDeviceId.trim()}`,
      gsi1sk: `SESSION#${record.sessionId.trim()}`,
      entityType: "TRANSFER_SESSION",
      sessionId: record.sessionId,
      token: record.token,
      requesterUserId: record.requesterUserId,
      targetUserId: record.targetUserId,
      targetDeviceId: record.targetDeviceId,
      gameKey: record.gameKey,
      manifestHash: record.manifestHash,
      expiresAt: record.expiresAt,
      expiresAtEpoch,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  /**
   * Lista las sesiones de transferencia pendientes para un dispositivo destino.
   */
  async listPendingTransferSessions(targetDeviceId: string): Promise<TransferSessionRecord[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :targetPk",
        ExpressionAttributeValues: {
          ":targetPk": `TARGET_DEVICE#${targetDeviceId.trim()}`,
        },
      })
    );

    const now = Date.now();
    const sessions: TransferSessionRecord[] = [];

    if (res.Items && res.Items.length > 0) {
      for (const raw of res.Items) {
        const item = raw as TransferSessionDbRecord;
        const exp = Date.parse(item.expiresAt);
        if (Number.isFinite(exp) && exp >= now) {
          sessions.push({
            sessionId: item.sessionId,
            token: item.token,
            requesterUserId: item.requesterUserId,
            targetUserId: item.targetUserId,
            targetDeviceId: item.targetDeviceId,
            gameKey: item.gameKey,
            manifestHash: item.manifestHash,
            expiresAt: item.expiresAt,
          });
        }
      }
      return sessions;
    }

    if (this.s3Fallback) {
      return this.s3Fallback.listPendingTransferSessions(targetDeviceId);
    }

    return [];
  }

  /**
   * Consume (elimina) una sesión de transferencia una vez completada.
   */
  async consumeTransferSession(sessionId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `SESSION#${sessionId.trim()}`,
          sk: "METADATA",
        },
      })
    );

    if (this.s3Fallback) {
      await this.s3Fallback.consumeTransferSession(sessionId).catch(() => {});
    }
  }
}
