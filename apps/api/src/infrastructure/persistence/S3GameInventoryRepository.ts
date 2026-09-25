import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { DeviceInventoryRecord, GameInventoryEntry, GameProviderDevice } from "@domain/entities/GameInventory";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type {
  GameInventoryRepository,
  PublishDeviceInventoryInput,
  TransferSessionRecord,
} from "@domain/ports/GameInventoryRepository";

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

function nowIso(): string {
  return new Date().toISOString();
}

function encodeGameKey(gameKey: string): string {
  return encodeURIComponent(gameKey.replace(/:/g, "_"));
}

export class S3GameInventoryRepository implements GameInventoryRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string,
    private readonly cloudInviteRepository: CloudInviteRepository
  ) {}

  private deviceKey(userId: string, deviceId: string): string {
    return `game-inventory/devices/${userId}/${deviceId}.json`;
  }

  private indexKey(hostUserId: string, gameKey: string): string {
    return `game-inventory/index/${hostUserId}/by-game/${encodeGameKey(gameKey)}.json`;
  }

  private async getJsonOrNull<T>(key: string): Promise<T | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      const raw = await res.Body?.transformToString();
      if (!raw?.trim()) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async putJson(key: string, value: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
      })
    );
  }

  private async deleteKey(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const item of res.Contents ?? []) {
        if (item.Key) out.push(item.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  private async resolveHostUserIds(userId: string): Promise<string[]> {
    const hosts = new Set<string>([userId]);
    const asMember = await this.cloudInviteRepository.listMembershipsForMember(userId);
    for (const m of asMember) {
      if (m.active) hosts.add(m.hostUserId);
    }
    const asHost = await this.cloudInviteRepository.listMembershipsForHost(userId);
    for (const m of asHost) {
      if (m.active) hosts.add(userId);
    }
    return [...hosts];
  }

  async getDeviceRecord(userId: string, deviceId: string): Promise<DeviceInventoryRecord | null> {
    return this.getJsonOrNull<DeviceInventoryRecord>(this.deviceKey(userId, deviceId));
  }

  private deviceToProvider(d: DeviceInventoryRecord, game: GameInventoryEntry): GameProviderDevice {
    return {
      userId: d.userId,
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      totalBytes: game.totalBytes,
      payloadKind: game.payloadKind,
      manifestHash: game.manifestHash,
      verifiedAt: game.verifiedAt,
      lastSeenAt: d.lastSeenAt,
    };
  }

  private async removeDeviceFromIndex(
    hostUserId: string,
    gameKey: string,
    userId: string,
    deviceId: string
  ): Promise<void> {
    const key = this.indexKey(hostUserId, gameKey);
    const index = await this.getJsonOrNull<{ version: 1; gameKey: string; devices: GameProviderDevice[] }>(key);
    if (!index) return;
    const devices = index.devices.filter((d) => !(d.userId === userId && d.deviceId === deviceId));
    if (devices.length === 0) {
      await this.deleteKey(key);
    } else {
      await this.putJson(key, { version: 1, gameKey, devices });
    }
  }

  private async addDeviceToIndex(
    hostUserId: string,
    record: DeviceInventoryRecord,
    game: GameInventoryEntry
  ): Promise<void> {
    const key = this.indexKey(hostUserId, game.gameKey);
    const index = (await this.getJsonOrNull<{ version: 1; gameKey: string; devices: GameProviderDevice[] }>(key)) ?? {
      version: 1 as const,
      gameKey: game.gameKey,
      devices: [],
    };
    const provider = this.deviceToProvider(record, game);
    const devices = index.devices.filter((d) => !(d.userId === record.userId && d.deviceId === record.deviceId));
    devices.push(provider);
    await this.putJson(key, { version: 1, gameKey: game.gameKey, devices });
  }

  async putDeviceInventory(input: PublishDeviceInventoryInput): Promise<void> {
    const verified = input.games.filter((g) => g.status === "verified");
    const previous = await this.getDeviceRecord(input.userId, input.deviceId);
    const previousKeys = new Set(previous?.games.map((g) => g.gameKey) ?? []);

    const record: DeviceInventoryRecord = {
      deviceId: input.deviceId,
      userId: input.userId,
      deviceName: input.deviceName,
      manifestVersion: input.manifestVersion,
      contentHash: input.contentHash,
      updatedAt: input.updatedAt,
      sharingEnabled: input.sharingEnabled,
      lastSeenAt: nowIso(),
      games: verified,
    };

    await this.putJson(this.deviceKey(input.userId, input.deviceId), record);

    const hostIds = await this.resolveHostUserIds(input.userId);
    const newKeys = new Set(verified.map((g) => g.gameKey));

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

    for (const game of verified) {
      for (const hostId of hostIds) {
        await this.addDeviceToIndex(hostId, record, game);
      }
    }
  }

  async deleteDeviceInventory(userId: string, deviceId: string): Promise<void> {
    const previous = await this.getDeviceRecord(userId, deviceId);
    await this.deleteKey(this.deviceKey(userId, deviceId));
    if (!previous) return;

    const hostIds = await this.resolveHostUserIds(userId);
    for (const game of previous.games) {
      for (const hostId of hostIds) {
        await this.removeDeviceFromIndex(hostId, game.gameKey, userId, deviceId);
      }
    }
  }

  async recordHeartbeat(userId: string, deviceId: string, appVersion?: string): Promise<void> {
    const record = await this.getDeviceRecord(userId, deviceId);
    if (!record) return;
    record.lastSeenAt = nowIso();
    if (appVersion?.trim()) record.appVersion = appVersion.trim();
    await this.putJson(this.deviceKey(userId, deviceId), record);
  }

  async listProvidersForGame(
    hostUserId: string,
    gameKey: string,
    excludeUserId?: string
  ): Promise<GameProviderDevice[]> {
    const key = this.indexKey(hostUserId, gameKey);
    const index = await this.getJsonOrNull<{ version: 1; devices: GameProviderDevice[] }>(key);
    if (!index?.devices?.length) return [];
    return index.devices.filter((d) => !excludeUserId || d.userId !== excludeUserId);
  }

  private transferSessionKey(sessionId: string): string {
    return `game-inventory/sessions/${sessionId}.json`;
  }

  private pendingSessionsPrefix(deviceId: string): string {
    return `game-inventory/pending/${deviceId}/`;
  }

  async putTransferSession(record: TransferSessionRecord): Promise<void> {
    await this.putJson(this.transferSessionKey(record.sessionId), record);
    await this.putJson(`${this.pendingSessionsPrefix(record.targetDeviceId)}${record.sessionId}.json`, {
      sessionId: record.sessionId,
    });
  }

  async listPendingTransferSessions(targetDeviceId: string): Promise<TransferSessionRecord[]> {
    const prefix = this.pendingSessionsPrefix(targetDeviceId);
    const keys = await this.listKeys(prefix);
    const out: TransferSessionRecord[] = [];
    const now = Date.now();
    for (const key of keys) {
      const stub = await this.getJsonOrNull<{ sessionId: string }>(key);
      if (!stub?.sessionId) continue;
      const session = await this.getJsonOrNull<TransferSessionRecord>(this.transferSessionKey(stub.sessionId));
      if (!session) {
        await this.deleteKey(key);
        continue;
      }
      const exp = Date.parse(session.expiresAt);
      if (!Number.isFinite(exp) || exp < now) {
        await this.deleteKey(key);
        await this.deleteKey(this.transferSessionKey(session.sessionId));
        continue;
      }
      out.push(session);
    }
    return out;
  }

  async consumeTransferSession(sessionId: string): Promise<void> {
    const session = await this.getJsonOrNull<TransferSessionRecord>(this.transferSessionKey(sessionId));
    if (!session) return;
    await this.deleteKey(this.transferSessionKey(sessionId));
    await this.deleteKey(`${this.pendingSessionsPrefix(session.targetDeviceId)}${sessionId}.json`);
  }
}
