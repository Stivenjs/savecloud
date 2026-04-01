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
  InitMultipartPartUrlsSchema,
  type InitMultipartPartUrlsBody,
  GetPartUrlsSchema,
  type GetPartUrlsBody,
  CompleteMultipartSchema,
  type CompleteMultipartBody,
  AbortMultipartSchema,
  type AbortMultipartBody,
} from "@interfaces/schema/saves";
import type { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import type { GetUploadUrlsUseCase } from "@application/use-cases/GetUploadUrlsUseCase";
import type { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import type { GetDownloadUrlsUseCase } from "@application/use-cases/GetDownloadUrlsUseCase";
import type { DeleteGameFromCloudUseCase } from "@application/use-cases/DeleteGameFromCloudUseCase";
import type { RenameGameInCloudUseCase } from "@application/use-cases/RenameGameInCloudUseCase";
import type { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import type { DeleteBackupUseCase } from "@application/use-cases/DeleteBackupUseCase";
import type { RenameBackupUseCase } from "@application/use-cases/RenameBackupUseCase";
import type { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { invalidateListSavesByGameCache } from "@application/use-cases/ListSavesUseCase";
import type { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import type { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import type { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import type { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import type { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { getUserId, getErrorMessage } from "@shared/utils";
import { TtlCache } from "@shared/ttlCache";

const savesSummaryCache = new TtlCache<string, unknown[]>({ ttlMs: 20_000, maxEntries: 200 });
const CLOUD_HOST_HEADER = "x-cloud-host-user-id";

function invalidateSavesCaches(userId: string, gameId?: string): void {
  savesSummaryCache.delete(userId);
  invalidateListSavesByGameCache(userId, gameId);
}

/**
 * Resuelve el prefijo de almacenamiento S3 para el usuario objetivo (anfitrión propio o miembro en nube compartida).
 * Usado por GET /saves?targetUserId= para listar guardados de otro usuario con x-user-id = solicitante autenticado.
 */
async function resolveTargetStorageUserId(
  targetUserId: string,
  resolveScope: ResolveCloudStorageScopeUseCase,
  repo: CloudInviteRepository
): Promise<string> {
  const memberships = await repo.listMembershipsForMember(targetUserId);
  const active = memberships.find((m) => m.active);
  if (active) {
    const scope = await resolveScope.execute(targetUserId, active.hostUserId);
    return scope.storageUserId;
  }
  return targetUserId;
}

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
    listBackupsUseCase: ListBackupsUseCase;
    deleteBackupUseCase: DeleteBackupUseCase;
    renameBackupUseCase: RenameBackupUseCase;
    createMultipartUploadUseCase: CreateMultipartUploadUseCase;
    createMultipartUploadWithPartUrlsUseCase: CreateMultipartUploadWithPartUrlsUseCase;
    getUploadPartUrlsUseCase: GetUploadPartUrlsUseCase;
    completeMultipartUploadUseCase: CompleteMultipartUploadUseCase;
    abortMultipartUploadUseCase: AbortMultipartUploadUseCase;
    resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase;
    cloudInviteRepository?: CloudInviteRepository;
  }
): Promise<void> {
  async function getStorageUserIdFromRequest(request: any): Promise<string> {
    const requesterUserId = getUserId(request);
    const hostHeader = request.headers[CLOUD_HOST_HEADER];
    const requestedHostUserId = typeof hostHeader === "string" && hostHeader.trim() ? hostHeader.trim() : undefined;
    if (!deps.resolveCloudStorageScopeUseCase) return requesterUserId;
    const scope = await deps.resolveCloudStorageScopeUseCase.execute(requesterUserId, requestedHostUserId);
    return scope.storageUserId;
  }

  app.get("/saves", async (request, reply) => {
    const requesterUserId = getUserId(request);
    const query: unknown = request.query;
    const raw = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
    const gameId = typeof raw.gameId === "string" ? raw.gameId.trim() : undefined;
    const targetUserIdRaw = typeof raw.targetUserId === "string" ? raw.targetUserId.trim() : undefined;

    let userId: string;
    if (!targetUserIdRaw || targetUserIdRaw === requesterUserId) {
      userId = await getStorageUserIdFromRequest(request);
    } else {
      if (!deps.cloudInviteRepository || !deps.resolveCloudStorageScopeUseCase) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "targetUserId requires cloud invite support",
        });
      }
      userId = await resolveTargetStorageUserId(
        targetUserIdRaw,
        deps.resolveCloudStorageScopeUseCase,
        deps.cloudInviteRepository
      );
    }

    const saves = await deps.listSavesUseCase.execute({ userId, gameId });
    return reply.send(saves);
  });

  app.get("/saves/summary", async (request, reply) => {
    const userId = await getStorageUserIdFromRequest(request);
    const cached = savesSummaryCache.get(userId);
    if (cached) return reply.send(cached);

    const saves = await deps.listSavesUseCase.execute({ userId });

    type Agg = { fileCount: number; totalSize: number; lastModified: Date | null };
    const byGame = new Map<string, Agg>();

    for (const s of saves) {
      const key = s.gameId;
      const existing = byGame.get(key) ?? { fileCount: 0, totalSize: 0, lastModified: null };
      const size = s.size ?? 0;
      const lm = s.lastModified;

      const nextLast =
        existing.lastModified == null || (lm && lm > existing.lastModified)
          ? (lm ?? existing.lastModified)
          : existing.lastModified;

      byGame.set(key, {
        fileCount: existing.fileCount + 1,
        totalSize: existing.totalSize + size,
        lastModified: nextLast,
      });
    }

    const summary = Array.from(byGame.entries()).map(([gameId, agg]) => ({
      gameId,
      fileCount: agg.fileCount,
      totalSizeBytes: agg.totalSize,
      lastModified: agg.lastModified ? agg.lastModified.toISOString() : null,
    }));

    savesSummaryCache.set(userId, summary);
    return reply.send(summary);
  });

  app.get<{ Querystring: ListBackupsQuery }>(
    "/saves/backups",
    { schema: { querystring: ListBackupsQuerySchema } },
    async (request, reply) => {
      const userId = getUserId(request);
      const storageUserId = await getStorageUserIdFromRequest(request);
      const result = await deps.listBackupsUseCase.execute({
        userId: storageUserId,
        gameId: request.query.gameId.trim(),
      });
      return reply.send(result);
    }
  );

  app.delete<{ Body: BackupKeyBody }>(
    "/saves/backup",
    { schema: { body: BackupKeySchema } },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request);
        const { gameId, key } = request.body;

        await deps.deleteBackupUseCase.execute({ userId: storageUserId, gameId: gameId.trim(), key: key.trim() });
        invalidateSavesCaches(userId, gameId);
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.startsWith("Invalid key:")) return reply.status(400).send({ error: "Bad Request", message });

        request.log.error({ err, message }, "delete backup failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.patch<{ Body: RenameBackupBody }>(
    "/saves/backup",
    { schema: { body: RenameBackupSchema } },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request);
        const { gameId, key, newFilename } = request.body;

        await deps.renameBackupUseCase.execute({
          userId: storageUserId,
          gameId: gameId.trim(),
          key: key.trim(),
          newFilename: newFilename.trim(),
        });
        invalidateSavesCaches(userId, gameId);
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.startsWith("Invalid key:") || message.includes("newFilename must")) {
          return reply.status(400).send({ error: "Bad Request", message });
        }
        request.log.error({ err, message }, "rename backup failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: GameIdOnlyBody }>(
    "/saves/delete-game",
    { schema: { body: GameIdOnlySchema } },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request);
        const gameId = request.body.gameId.trim();
        await deps.deleteGameFromCloudUseCase.execute({ userId: storageUserId, gameId });
        invalidateSavesCaches(userId, gameId);
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "delete-game failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: RenameGameBody }>(
    "/saves/rename-game",
    { schema: { body: RenameGameSchema } },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const storageUserId = await getStorageUserIdFromRequest(request);
        const oldGameId = request.body.oldGameId.trim();
        const newGameId = request.body.newGameId.trim();

        if (oldGameId === newGameId) {
          return reply.status(400).send({ error: "Bad Request", message: "oldGameId and newGameId must be different" });
        }

        await deps.renameGameInCloudUseCase.execute({ userId: storageUserId, oldGameId, newGameId });
        invalidateSavesCaches(userId, oldGameId);
        invalidateSavesCaches(userId, newGameId);
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "rename-game failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: UploadUrlBody }>(
    "/saves/upload-url",
    { schema: { body: UploadUrlSchema } },
    async (request, reply) => {
      const userId = await getStorageUserIdFromRequest(request);
      const { gameId, filename } = request.body;

      const result = await deps.getUploadUrlUseCase.execute({
        userId,
        gameId: gameId.trim(),
        filename: filename.trim(),
      });
      return reply.send(result);
    }
  );

  app.post<{ Body: UploadUrlsBatchBody }>(
    "/saves/upload-urls",
    { schema: { body: UploadUrlsBatchSchema } },
    async (request, reply) => {
      try {
        const userId = await getStorageUserIdFromRequest(request);
        const items = request.body.items.map((x) => ({ gameId: x.gameId.trim(), filename: x.filename.trim() }));

        const result = await deps.getUploadUrlsUseCase.execute({ userId, items });
        return reply.send(result);
      } catch (err) {
        request.log.error({ err }, "upload-urls failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: DownloadUrlBody }>(
    "/saves/download-url",
    { schema: { body: DownloadUrlSchema } },
    async (request, reply) => {
      try {
        const requesterUserId = getUserId(request);
        const userId = await getStorageUserIdFromRequest(request);
        const { gameId, key, range } = request.body;
        if (
          deps.cloudInviteRepository &&
          key.startsWith(`${requesterUserId}/${gameId.trim()}/`) &&
          userId !== requesterUserId
        ) {
          const hostUserId = userId.split("::member::")[0];
          const canReadShared = await deps.cloudInviteRepository.isGameSharedWithMember(
            hostUserId,
            requesterUserId,
            gameId.trim()
          );
          if (!canReadShared) {
            return reply.status(403).send({ error: "Forbidden", message: "Game is not shared for this member" });
          }
        }

        const result = await deps.getDownloadUrlUseCase.execute({
          userId,
          gameId: gameId.trim(),
          key: key.trim(),
          range,
        });
        return reply.send(result);
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.startsWith("Invalid key:")) return reply.status(400).send({ error: "Bad Request", message });

        request.log.error({ err }, "download-url failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: DownloadUrlsBatchBody }>(
    "/saves/download-urls",
    { schema: { body: DownloadUrlsBatchSchema } },
    async (request, reply) => {
      try {
        const userId = await getStorageUserIdFromRequest(request);
        const items = request.body.items.map((x) => ({ gameId: x.gameId.trim(), key: x.key.trim() }));

        const result = await deps.getDownloadUrlsUseCase.execute({ userId, items });
        return reply.send(result);
      } catch (err) {
        request.log.error({ err }, "download-urls failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: UploadUrlBody }>(
    "/saves/multipart/init",
    { schema: { body: UploadUrlSchema } },
    async (request, reply) => {
      const userId = await getStorageUserIdFromRequest(request);
      const { gameId, filename } = request.body;

      const result = await deps.createMultipartUploadUseCase.execute({
        userId,
        gameId: gameId.trim(),
        filename: filename.trim(),
      });
      return reply.send(result);
    }
  );

  app.post<{ Body: InitMultipartPartUrlsBody }>(
    "/saves/multipart/init-with-part-urls",
    { schema: { body: InitMultipartPartUrlsSchema } },
    async (request, reply) => {
      const userId = await getStorageUserIdFromRequest(request);
      const { gameId, filename, partCount } = request.body;

      const result = await deps.createMultipartUploadWithPartUrlsUseCase.execute({
        userId,
        gameId: gameId.trim(),
        filename: filename.trim(),
        partCount,
      });
      return reply.send(result);
    }
  );

  app.post<{ Body: GetPartUrlsBody }>(
    "/saves/multipart/part-urls",
    { schema: { body: GetPartUrlsSchema } },
    async (request, reply) => {
      const { key, uploadId, partNumbers } = request.body;

      const result = await deps.getUploadPartUrlsUseCase.execute({
        key: key.trim(),
        uploadId: uploadId.trim(),
        partNumbers,
      });
      return reply.send(result);
    }
  );

  app.post<{ Body: CompleteMultipartBody }>(
    "/saves/multipart/complete",
    { schema: { body: CompleteMultipartSchema } },
    async (request, reply) => {
      try {
        const { key, uploadId, parts } = request.body;

        await deps.completeMultipartUploadUseCase.execute({
          key: key.trim(),
          uploadId: uploadId.trim(),
          parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag.trim() })),
        });
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "multipart/complete failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: AbortMultipartBody }>(
    "/saves/multipart/abort",
    { schema: { body: AbortMultipartSchema } },
    async (request, reply) => {
      try {
        const { key, uploadId } = request.body;
        await deps.abortMultipartUploadUseCase.execute({
          key: key.trim(),
          uploadId: uploadId.trim(),
        });
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "multipart/abort failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );
}
