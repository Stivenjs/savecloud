import { Type, type Static } from "@sinclair/typebox";

export const ListBackupsQuerySchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
});
export type ListBackupsQuery = Static<typeof ListBackupsQuerySchema>;

export const BackupKeySchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
});
export type BackupKeyBody = Static<typeof BackupKeySchema>;

export const RenameBackupSchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
  newFilename: Type.String({ minLength: 1 }),
});
export type RenameBackupBody = Static<typeof RenameBackupSchema>;

export const GameIdOnlySchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
});
export type GameIdOnlyBody = Static<typeof GameIdOnlySchema>;

export const RenameGameSchema = Type.Object({
  oldGameId: Type.String({ minLength: 1 }),
  newGameId: Type.String({ minLength: 1 }),
});
export type RenameGameBody = Static<typeof RenameGameSchema>;

export const UploadUrlSchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
  filename: Type.String({ minLength: 1 }),
});
export type UploadUrlBody = Static<typeof UploadUrlSchema>;

export const UploadUrlsBatchSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      gameId: Type.String({ minLength: 1 }),
      filename: Type.String({ minLength: 1 }),
    }),
    { minItems: 1, maxItems: 500 }
  ),
});
export type UploadUrlsBatchBody = Static<typeof UploadUrlsBatchSchema>;

export const DownloadUrlSchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
  range: Type.Optional(
    Type.Object({
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 0 }),
    })
  ),
});
export type DownloadUrlBody = Static<typeof DownloadUrlSchema>;

export const DownloadUrlsBatchSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      gameId: Type.String({ minLength: 1 }),
      key: Type.String({ minLength: 1 }),
    }),
    { minItems: 1, maxItems: 500 }
  ),
});
export type DownloadUrlsBatchBody = Static<typeof DownloadUrlsBatchSchema>;

export const InitMultipartPartUrlsSchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
  filename: Type.String({ minLength: 1 }),
  partCount: Type.Integer({ minimum: 1, maximum: 200 }),
});
export type InitMultipartPartUrlsBody = Static<typeof InitMultipartPartUrlsSchema>;

export const GetPartUrlsSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  uploadId: Type.String({ minLength: 1 }),
  partNumbers: Type.Array(Type.Integer({ minimum: 1, maximum: 10000 }), { minItems: 1 }),
});
export type GetPartUrlsBody = Static<typeof GetPartUrlsSchema>;

export const CompleteMultipartSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  uploadId: Type.String({ minLength: 1 }),
  parts: Type.Array(
    Type.Object({
      partNumber: Type.Integer({ minimum: 1 }),
      etag: Type.String({ minLength: 1 }),
    }),
    { minItems: 1 }
  ),
});
export type CompleteMultipartBody = Static<typeof CompleteMultipartSchema>;

export const AbortMultipartSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  uploadId: Type.String({ minLength: 1 }),
});
export type AbortMultipartBody = Static<typeof AbortMultipartSchema>;

export const SteamSeedManifestUploadUrlSchema = Type.Object({
  partIndex: Type.Integer({ minimum: 0 }),
});
export type SteamSeedManifestUploadUrlBody = Static<typeof SteamSeedManifestUploadUrlSchema>;

export const SteamSeedBatchDownloadUrlSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
});
export type SteamSeedBatchDownloadUrlBody = Static<typeof SteamSeedBatchDownloadUrlSchema>;

export const SteamSeedBatchesQuerySchema = Type.Object({
  maxKeys: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
});
export type SteamSeedBatchesQuery = Static<typeof SteamSeedBatchesQuerySchema>;
