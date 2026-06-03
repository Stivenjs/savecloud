import { Type, type Static } from "@sinclair/typebox";

const InventoryFileSchema = Type.Object({
  relativePath: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  hash: Type.String({ minLength: 8 }),
});

const GameInventoryEntrySchema = Type.Object({
  gameKey: Type.String({ minLength: 3 }),
  displayName: Type.String({ minLength: 1 }),
  status: Type.Literal("verified"),
  payloadKind: Type.Union([Type.Literal("installedFolder"), Type.Literal("sourcesArchive")]),
  totalBytes: Type.Integer({ minimum: 0 }),
  fileCount: Type.Integer({ minimum: 0 }),
  manifestHash: Type.String({ minLength: 8 }),
  verifiedAt: Type.String({ minLength: 10 }),
  files: Type.Array(InventoryFileSchema),
  sourcesArchive: Type.Optional(
    Type.Object({
      jobId: Type.String(),
      relativePath: Type.String(),
      size: Type.Integer({ minimum: 0 }),
      hash: Type.String(),
      verifiedAt: Type.String(),
    })
  ),
});

export const PublishDeviceInventorySchema = Type.Object({
  deviceName: Type.String({ minLength: 1 }),
  manifestVersion: Type.Integer({ minimum: 1 }),
  contentHash: Type.String({ minLength: 8 }),
  updatedAt: Type.String({ minLength: 10 }),
  sharingEnabled: Type.Boolean(),
  games: Type.Array(GameInventoryEntrySchema),
});

export type PublishDeviceInventoryBody = Static<typeof PublishDeviceInventorySchema>;

export const InventoryHeartbeatSchema = Type.Object({
  appVersion: Type.Optional(Type.String()),
});

export type InventoryHeartbeatBody = Static<typeof InventoryHeartbeatSchema>;

export const CreateTransferSessionSchema = Type.Object({
  targetUserId: Type.String({ minLength: 1 }),
  targetDeviceId: Type.String({ minLength: 1 }),
  gameKey: Type.String({ minLength: 3 }),
  manifestHash: Type.String({ minLength: 8 }),
});

export type CreateTransferSessionBody = Static<typeof CreateTransferSessionSchema>;
