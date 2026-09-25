export interface InventoryFileEntry {
  relativePath: string;
  size: number;
  hash: string;
}

export interface SourcesArchiveEntry {
  jobId: string;
  relativePath: string;
  size: number;
  hash: string;
  verifiedAt: string;
}

export interface GameInventoryEntry {
  gameKey: string;
  displayName: string;
  status: string;
  payloadKind: string;
  totalBytes: number;
  fileCount: number;
  manifestHash: string;
  verifiedAt: string;
  files: InventoryFileEntry[];
  sourcesArchive?: SourcesArchiveEntry;
}

export interface DeviceInventoryRecord {
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

export interface GameProviderDevice {
  userId: string;
  deviceId: string;
  deviceName: string;
  totalBytes: number;
  payloadKind: string;
  manifestHash: string;
  verifiedAt: string;
  lastSeenAt?: string;
  files?: InventoryFileEntry[];
}

export interface GameIndexEntry {
  version: 1;
  gameKey: string;
  devices: GameProviderDevice[];
}
