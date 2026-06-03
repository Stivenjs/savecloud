import type { DeviceInventoryRecord, GameInventoryEntry, GameProviderDevice } from "@domain/entities/GameInventory";

export interface PublishDeviceInventoryInput {
  userId: string;
  deviceId: string;
  deviceName: string;
  manifestVersion: number;
  contentHash: string;
  updatedAt: string;
  sharingEnabled: boolean;
  games: GameInventoryEntry[];
}

export interface TransferSessionRecord {
  sessionId: string;
  token: string;
  requesterUserId: string;
  targetUserId: string;
  targetDeviceId: string;
  gameKey: string;
  manifestHash: string;
  expiresAt: string;
}

export interface GameInventoryRepository {
  putDeviceInventory(input: PublishDeviceInventoryInput): Promise<void>;
  deleteDeviceInventory(userId: string, deviceId: string): Promise<void>;
  recordHeartbeat(userId: string, deviceId: string, appVersion?: string): Promise<void>;
  listProvidersForGame(hostUserId: string, gameKey: string, excludeUserId?: string): Promise<GameProviderDevice[]>;
  getDeviceRecord(userId: string, deviceId: string): Promise<DeviceInventoryRecord | null>;
  putTransferSession(record: TransferSessionRecord): Promise<void>;
  listPendingTransferSessions(targetDeviceId: string): Promise<TransferSessionRecord[]>;
  consumeTransferSession(sessionId: string): Promise<void>;
}
