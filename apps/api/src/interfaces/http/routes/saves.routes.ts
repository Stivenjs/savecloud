import type { FastifyInstance } from "fastify";
import {
  ListBackupsQuerySchema,
  type ListBackupsQuery,
  BackupKeySchema,
  type BackupKeyBody,
  RenameBackupSchema,
  type RenameBackupBody,
  GameIdOnlySchema,
  type GameIdOnlyBody,
  RenameGameSchema,
  type RenameGameBody,
  UploadUrlSchema,
  type UploadUrlBody,
  UploadUrlsBatchSchema,
  type UploadUrlsBatchBody,
  DownloadUrlSchema,
  type DownloadUrlBody,
  DownloadUrlsBatchSchema,
  type DownloadUrlsBatchBody,
  ListSavesResponseSchema,
  GameSummaryResponseSchema,
  ErrorResponseSchema,
  UploadUrlResponseSchema,
  UploadUrlsBatchResponseSchema,
  DownloadUrlResponseSchema,
  DownloadUrlsBatchResponseSchema,
  ListBackupsResponseSchema,
} from "@interfaces/schema/saves";
import type { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import type { GetUploadUrlsUseCase } from "@application/use-cases/GetUploadUrlsUseCase";
import type { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import type { GetDownloadUrlsUseCase } from "@application/use-cases/GetDownloadUrlsUseCase";
import type { DeleteGameFromCloudUseCase } from "@application/use-cases/DeleteGameFromCloudUseCase";
import type { RenameGameInCloudUseCase } from "@application/use-cases/RenameGameInCloudUseCase";
import type { GetGameSummaryUseCase } from "@application/use-cases/GetGameSummaryUseCase";
import type { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import type { DeleteBackupUseCase } from "@application/use-cases/DeleteBackupUseCase";
import type { RenameBackupUseCase } from "@application/use-cases/RenameBackupUseCase";
import type { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { invalidateListSavesByGameCache } from "@application/use-cases/ListSavesUseCase";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import type { ResolveTargetStorageUserIdUseCase } from "@application/use-cases/ResolveTargetStorageUserIdUseCase";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { getUserId } from "@interfaces/http/helpers/request-context";
import { ApplicationError } from "@application/errors/ApplicationError";
import { computeSavesEtag, computeSummaryEtag, send304IfNotModified, type SummaryEtagItem } from "@shared/etag";
import { getStorageUserIdFromRequest } from "@interfaces/http/helpers/saves-route-helpers";
import {
  cacheBackups,
  cacheSavesSummary,
  getCachedBackups,
  getCachedSavesSummary,
  invalidateBackupsCache,
  invalidateSavesCaches,
} from "@interfaces/http/helpers/saves-cache";

export async function registerSavesRoutes(
  app: FastifyInstance,
  deps: {
    getUploadUrlUseCase: GetUploadUrlUseCase;
    getUploadUrlsUseCase: GetUploadUrlsUseCase;
    getDownloadUrlUseCase: GetDownloadUrlUseCase;
    getDownloadUrlsUseCase: GetDownloadUrlsUseCase;
    deleteGameFromCloudUseCase: DeleteGameFromCloudUseCase;
    renameGameInCloudUseCase: RenameGameInCloudUseCase;
    listSavesUseCase: ListSavesUseCase;
    getGameSummaryUseCase?: GetGameSummaryUseCase;
    listBackupsUseCase: ListBackupsUseCase;
    deleteBackupUseCase: DeleteBackupUseCase;
    renameBackupUseCase: RenameBackupUseCase;
    resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase;
    cloudInviteRepository?: CloudInviteRepository;
    resolveTargetStorageUserIdUseCase?: ResolveTargetStorageUserIdUseCase;
  }
): Promise<void> {
  app.get(
    "/saves",
    {
      schema: {
        response: {
          200: ListSavesResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const requesterUserId = getUserId(request);
      const query: unknown = request.query;
      const raw = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
      const gameId = typeof raw.gameId === "string" ? raw.gameId.trim() : undefined;
      const targetUserIdRaw = typeof raw.targetUserId === "string" ? raw.targetUserId.trim() : undefined;

      let userId: string;
      if (!targetUserIdRaw || targetUserIdRaw === requesterUserId) {
        userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
      } else {
        if (!deps.cloudInviteRepository || !deps.resolveTargetStorageUserIdUseCase) {
          throw new ApplicationError("FORBIDDEN", "No está habilitado el acceso a la nube del usuario solicitado.");
        }
        userId = await deps.resolveTargetStorageUserIdUseCase.execute(targetUserIdRaw);
      }

      const saves = await deps.listSavesUseCase.execute({ userId, gameId });
      const etag = computeSavesEtag(saves);
      if (send304IfNotModified(request, reply, etag)) return;

      return reply.send(saves);
    }
  );

  app.get("/saves/summary", { schema: { response: { 200: GameSummaryResponseSchema } } }, async (request, reply) => {
    const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
    const cached = getCachedSavesSummary(userId);
    if (cached) {
      const etag = computeSummaryEtag(cached);
      if (send304IfNotModified(request, reply, etag)) return;
      return reply.send(cached);
    }

    let summary: SummaryEtagItem[];

    if (deps.getGameSummaryUseCase) {
      const rawSummary = await deps.getGameSummaryUseCase.execute(userId);
      summary = rawSummary.map((s) => ({
        gameId: s.gameId,
        fileCount: s.fileCount,
        totalSizeBytes: s.totalSizeBytes,
        lastModified: s.lastModified ? s.lastModified.toISOString() : null,
      }));
    } else {
      const saves = await deps.listSavesUseCase.execute({ userId });
      type Agg = { fileCount: number; totalSize: number; lastModified: Date | null };
      const byGame = new Map<string, Agg>();

      for (const s of saves) {
        const key = s.gameId;
        const existing = byGame.get(key) ?? { fileCount: 0, totalSize: 0, lastModified: null };
        const nextLast =
          existing.lastModified == null || (s.lastModified && s.lastModified > existing.lastModified)
            ? (s.lastModified ?? existing.lastModified)
            : existing.lastModified;

        byGame.set(key, {
          fileCount: existing.fileCount + 1,
          totalSize: existing.totalSize + (s.size ?? 0),
          lastModified: nextLast,
        });
      }

      summary = Array.from(byGame.entries()).map(([gameId, agg]) => ({
        gameId,
        fileCount: agg.fileCount,
        totalSizeBytes: agg.totalSize,
        lastModified: agg.lastModified ? agg.lastModified.toISOString() : null,
      }));
    }

    cacheSavesSummary(userId, summary);
    const etag = computeSummaryEtag(summary);
    if (send304IfNotModified(request, reply, etag)) return;
    return reply.send(summary);
  });

  app.get<{ Querystring: ListBackupsQuery }>(
    "/saves/backups",
    {
      schema: {
        querystring: ListBackupsQuerySchema,
        response: {
          200: ListBackupsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const storageUserId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
      const gameId = request.query.gameId.trim();
      const cached = getCachedBackups(storageUserId, gameId);
      if (cached) return reply.send(cached);

      const result = await deps.listBackupsUseCase.execute({ userId: storageUserId, gameId });
      cacheBackups(storageUserId, gameId, result);
      return reply.send(result);
    }
  );

  app.delete<{ Body: BackupKeyBody }>(
    "/saves/backup",
    { schema: { body: BackupKeySchema } },
    async (request, reply) => {
      {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const { gameId, key } = request.body;

        await deps.deleteBackupUseCase.execute({ userId: storageUserId, gameId: gameId.trim(), key: key.trim() });
        invalidateSavesCaches(userId, gameId);
        invalidateBackupsCache(storageUserId, gameId);
        return reply.status(204).send();
      }
    }
  );

  app.patch<{ Body: RenameBackupBody }>(
    "/saves/backup",
    { schema: { body: RenameBackupSchema } },
    async (request, reply) => {
      {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const { gameId, key, newFilename } = request.body;

        await deps.renameBackupUseCase.execute({
          userId: storageUserId,
          gameId: gameId.trim(),
          key: key.trim(),
          newFilename: newFilename.trim(),
        });
        invalidateSavesCaches(userId, gameId);
        invalidateBackupsCache(storageUserId, gameId);
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: GameIdOnlyBody }>(
    "/saves/delete-game",
    { schema: { body: GameIdOnlySchema } },
    async (request, reply) => {
      {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const gameId = request.body.gameId.trim();
        const permanent = request.body.permanent === true;
        await deps.deleteGameFromCloudUseCase.execute({ userId: storageUserId, gameId, permanent });
        invalidateSavesCaches(userId, gameId);
        invalidateBackupsCache(storageUserId, gameId);
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: RenameGameBody }>(
    "/saves/rename-game",
    { schema: { body: RenameGameSchema } },
    async (request, reply) => {
      {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const oldGameId = request.body.oldGameId.trim();
        const newGameId = request.body.newGameId.trim();

        if (oldGameId === newGameId) {
          throw new ApplicationError("INVALID_ARGUMENT", "El juego de origen y destino deben ser diferentes.");
        }

        await deps.renameGameInCloudUseCase.execute({ userId: storageUserId, oldGameId, newGameId });
        invalidateSavesCaches(userId, oldGameId);
        invalidateSavesCaches(userId, newGameId);
        invalidateBackupsCache(storageUserId, oldGameId);
        invalidateBackupsCache(storageUserId, newGameId);
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: UploadUrlBody }>(
    "/saves/upload-url",
    {
      schema: {
        body: UploadUrlSchema,
        response: {
          200: UploadUrlResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      {
        const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const { gameId, filename } = request.body;

        const result = await deps.getUploadUrlUseCase.execute({
          userId,
          gameId: gameId.trim(),
          filename: filename.trim(),
        });
        return reply.send(result);
      }
    }
  );

  app.post<{ Body: UploadUrlsBatchBody }>(
    "/saves/upload-urls",
    {
      schema: {
        body: UploadUrlsBatchSchema,
        response: {
          200: UploadUrlsBatchResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      {
        const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const items = request.body.items.map((x) => ({ gameId: x.gameId.trim(), filename: x.filename.trim() }));

        const result = await deps.getUploadUrlsUseCase.execute({ userId, items });
        return reply.send(result);
      }
    }
  );

  app.post<{ Body: DownloadUrlBody }>(
    "/saves/download-url",
    {
      schema: {
        body: DownloadUrlSchema,
        response: {
          200: DownloadUrlResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      {
        const requesterUserId = getUserId(request);
        const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const rawKey = request.body.key ?? request.body.backupKey;
        if (!rawKey || !rawKey.trim()) {
          throw new ApplicationError("INVALID_ARGUMENT", "La clave es obligatoria.");
        }
        const { gameId, range } = request.body;
        const trimmedGameId = gameId.trim();
        const trimmedKey = rawKey.trim();
        if (
          deps.cloudInviteRepository &&
          trimmedKey.startsWith(`${requesterUserId}/${trimmedGameId}/`) &&
          userId !== requesterUserId
        ) {
          const hostUserId = userId.split("::member::")[0];
          const canReadShared = await deps.cloudInviteRepository.isGameSharedWithMember(
            hostUserId,
            requesterUserId,
            trimmedGameId
          );
          if (!canReadShared) {
            throw new ApplicationError("FORBIDDEN", "El juego no está compartido con este miembro.");
          }
        }

        const result = await deps.getDownloadUrlUseCase.execute({
          userId,
          gameId: trimmedGameId,
          key: trimmedKey,
          range,
        });
        return reply.send(result);
      }
    }
  );

  app.post<{ Body: DownloadUrlsBatchBody }>(
    "/saves/download-urls",
    {
      schema: {
        body: DownloadUrlsBatchSchema,
        response: {
          200: DownloadUrlsBatchResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      {
        const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
        const items = request.body.items.map((x) => ({ gameId: x.gameId.trim(), key: x.key.trim() }));

        const result = await deps.getDownloadUrlsUseCase.execute({ userId, items });
        return reply.send(result);
      }
    }
  );
}
