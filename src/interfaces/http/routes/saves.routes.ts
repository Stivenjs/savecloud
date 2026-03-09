import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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
import type { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import type { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import type { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import type { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import type { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: FastifyRequest): string {
  const userId = request.headers[USER_ID_HEADER];
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Missing or invalid x-user-id header");
  }
  return userId.trim();
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err != null &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  if (err != null && typeof err === "object" && "code" in err)
    return String((err as { code: unknown }).code);
  return String(err);
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
  }
): Promise<void> {
  app.get("/saves", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const saves = await deps.listSavesUseCase.execute({ userId });
    return reply.send(saves);
  });

  app.get(
    "/saves/backups",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(request);
      const gameId = (request.query as { gameId?: string })?.gameId?.trim();
      if (!gameId) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "query gameId is required",
        });
      }
      const result = await deps.listBackupsUseCase.execute({ userId, gameId });
      return reply.send(result);
    }
  );

  app.delete<{
    Body: { gameId: string; key: string };
  }>("/saves/backup", async (request, reply) => {
    try {
      const userId = getUserId(request);
      const body = request.body as { gameId?: string; key?: string };
      const gameId = body?.gameId?.trim();
      const key = body?.key?.trim();
      if (!gameId || !key) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "gameId and key are required",
        });
      }
      await deps.deleteBackupUseCase.execute({ userId, gameId, key });
      return reply.status(204).send();
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.startsWith("Invalid key:")) {
        return reply.status(400).send({ error: "Bad Request", message });
      }
      request.log.error({ err, message }, "delete backup failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message,
      });
    }
  });

  app.patch<{
    Body: { gameId: string; key: string; newFilename: string };
  }>("/saves/backup", async (request, reply) => {
    try {
      const userId = getUserId(request);
      const body = request.body as {
        gameId?: string;
        key?: string;
        newFilename?: string;
      };
      const gameId = body?.gameId?.trim();
      const key = body?.key?.trim();
      const newFilename = body?.newFilename?.trim();
      if (!gameId || !key || !newFilename) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "gameId, key and newFilename are required",
        });
      }
      await deps.renameBackupUseCase.execute({
        userId,
        gameId,
        key,
        newFilename,
      });
      return reply.status(204).send();
    } catch (err) {
      const message = getErrorMessage(err);
      if (
        message.startsWith("Invalid key:") ||
        message.includes("newFilename must")
      ) {
        return reply.status(400).send({ error: "Bad Request", message });
      }
      request.log.error({ err, message }, "rename backup failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message,
      });
    }
  });

  app.post<{
    Body: { gameId: string; filename: string };
  }>("/saves/upload-url", async (request, reply) => {
    const userId = getUserId(request);
    const { gameId, filename } = request.body ?? {};
    if (!gameId?.trim() || !filename?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "gameId and filename are required",
      });
    }
    const result = await deps.getUploadUrlUseCase.execute({
      userId,
      gameId: gameId.trim(),
      filename: filename.trim(),
    });
    return reply.send(result);
  });

  const UPLOAD_URLS_MAX_ITEMS = 500;
  const DOWNLOAD_URLS_MAX_ITEMS = 500;

  app.post<{
    Body: { items: Array<{ gameId: string; filename: string }> };
  }>("/saves/upload-urls", async (request, reply) => {
    try {
      const userId = getUserId(request);
      const body = request.body as {
        items?: Array<{ gameId?: string; filename?: string }>;
      };
      const raw = body?.items ?? [];
      if (!Array.isArray(raw) || raw.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "items (non-empty array of { gameId, filename }) is required",
        });
      }
      const items = raw
        .map((x) =>
          x?.gameId?.trim() && x?.filename?.trim()
            ? { gameId: x.gameId.trim(), filename: x.filename.trim() }
            : null
        )
        .filter((x): x is { gameId: string; filename: string } => x !== null);
      if (items.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Every item must have gameId and filename",
        });
      }
      if (items.length > UPLOAD_URLS_MAX_ITEMS) {
        return reply.status(400).send({
          error: "Bad Request",
          message: `Maximum ${UPLOAD_URLS_MAX_ITEMS} items per request. The client should split into batches.`,
        });
      }
      const result = await deps.getUploadUrlsUseCase.execute({ userId, items });
      return reply.send(result);
    } catch (err) {
      const message = getErrorMessage(err);
      request.log.error({ err, message }, "upload-urls failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message,
      });
    }
  });

  app.post<{
    Body: { items: Array<{ gameId: string; key: string }> };
  }>("/saves/download-urls", async (request, reply) => {
    try {
      const userId = getUserId(request);
      const body = request.body as {
        items?: Array<{ gameId?: string; key?: string }>;
      };
      const raw = body?.items ?? [];
      if (!Array.isArray(raw) || raw.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "items (non-empty array of { gameId, key }) is required",
        });
      }
      const items = raw
        .map((x) =>
          x?.gameId?.trim() && x?.key?.trim()
            ? { gameId: x.gameId.trim(), key: x.key.trim() }
            : null
        )
        .filter((x): x is { gameId: string; key: string } => x !== null);
      if (items.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Every item must have gameId and key",
        });
      }
      if (items.length > DOWNLOAD_URLS_MAX_ITEMS) {
        return reply.status(400).send({
          error: "Bad Request",
          message: `Maximum ${DOWNLOAD_URLS_MAX_ITEMS} items per request. Split into batches.`,
        });
      }
      const result = await deps.getDownloadUrlsUseCase.execute({
        userId,
        items,
      });
      return reply.send(result);
    } catch (err) {
      const message = getErrorMessage(err);
      request.log.error({ err, message }, "download-urls failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message,
      });
    }
  });

  app.post<{
    Body: {
      gameId: string;
      key: string;
      range?: { start: number; end: number };
    };
  }>("/saves/download-url", async (request, reply) => {
    try {
      const userId = getUserId(request);
      const body = request.body as {
        gameId?: string;
        key?: string;
        range?: { start?: number; end?: number };
      };
      const { gameId, key, range } = body ?? {};
      if (!gameId?.trim() || !key?.trim()) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "gameId and key are required",
        });
      }
      const rangeArg =
        range != null &&
        typeof range.start === "number" &&
        typeof range.end === "number"
          ? { start: range.start, end: range.end }
          : undefined;
      const result = await deps.getDownloadUrlUseCase.execute({
        userId,
        gameId: gameId.trim(),
        key: key.trim(),
        range: rangeArg,
      });
      return reply.send(result);
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.startsWith("Invalid key:")) {
        return reply.status(400).send({ error: "Bad Request", message });
      }
      request.log.error({ err, message }, "download-url failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message,
      });
    }
  });

  // --- Multipart upload (archivos grandes: pausar, reanudar, cancelar) ---

  app.post<{
    Body: { gameId: string; filename: string };
  }>("/saves/multipart/init", async (request, reply) => {
    const userId = getUserId(request);
    const { gameId, filename } = request.body ?? {};
    if (!gameId?.trim() || !filename?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "gameId and filename are required",
      });
    }
    const result = await deps.createMultipartUploadUseCase.execute({
      userId,
      gameId: gameId.trim(),
      filename: filename.trim(),
    });
    return reply.send(result);
  });

  app.post<{
    Body: { gameId: string; filename: string; partCount: number };
  }>("/saves/multipart/init-with-part-urls", async (request, reply) => {
    const userId = getUserId(request);
    const body = request.body as {
      gameId?: string;
      filename?: string;
      partCount?: number;
    };
    const { gameId, filename, partCount } = body ?? {};
    if (!gameId?.trim() || !filename?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "gameId and filename are required",
      });
    }
    const count =
      typeof partCount === "number" && partCount >= 1
        ? Math.min(Math.floor(partCount), 2000)
        : 1;
    const result = await deps.createMultipartUploadWithPartUrlsUseCase.execute({
      userId,
      gameId: gameId.trim(),
      filename: filename.trim(),
      partCount: count,
    });
    return reply.send(result);
  });

  app.post<{
    Body: { key: string; uploadId: string; partNumbers: number[] };
  }>("/saves/multipart/part-urls", async (request, reply) => {
    const body = request.body as {
      key?: string;
      uploadId?: string;
      partNumbers?: number[];
    };
    const { key, uploadId, partNumbers } = body ?? {};
    if (!key?.trim() || !uploadId?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "key and uploadId are required",
      });
    }
    const numbers = Array.isArray(partNumbers)
      ? partNumbers.filter((n) => typeof n === "number" && n >= 1 && n <= 10000)
      : [];
    if (numbers.length === 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "partNumbers must be a non-empty array of integers 1..10000",
      });
    }
    const result = await deps.getUploadPartUrlsUseCase.execute({
      key: key.trim(),
      uploadId: uploadId.trim(),
      partNumbers: numbers,
    });
    return reply.send(result);
  });

  app.post<{
    Body: {
      key: string;
      uploadId: string;
      parts: Array<{ partNumber: number; etag: string }>;
    };
  }>("/saves/multipart/complete", async (request, reply) => {
    const body = request.body as {
      key?: string;
      uploadId?: string;
      parts?: Array<{ partNumber?: number; etag?: string }>;
    };
    const { key, uploadId, parts } = body ?? {};
    if (!key?.trim() || !uploadId?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "key and uploadId are required",
      });
    }
    const partsArray: Array<{ partNumber: number; etag: string }> =
      Array.isArray(parts)
        ? parts
            .filter(
              (p): p is { partNumber: number; etag: string } =>
                typeof p?.partNumber === "number" && typeof p?.etag === "string"
            )
            .map((p) => ({ partNumber: p.partNumber, etag: p.etag.trim() }))
        : [];
    if (partsArray.length === 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "parts must be a non-empty array of { partNumber, etag }",
      });
    }
    try {
      await deps.completeMultipartUploadUseCase.execute({
        key: key.trim(),
        uploadId: uploadId.trim(),
        parts: partsArray,
      });
    } catch (err) {
      request.log.error({ err, key, uploadId }, "multipart/complete failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to complete multipart upload",
      });
    }
    return reply.code(204).send();
  });

  app.post<{
    Body: { key: string; uploadId: string };
  }>("/saves/multipart/abort", async (request, reply) => {
    const { key, uploadId } = request.body ?? {};
    if (!key?.trim() || !uploadId?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "key and uploadId are required",
      });
    }
    try {
      await deps.abortMultipartUploadUseCase.execute({
        key: (key as string).trim(),
        uploadId: (uploadId as string).trim(),
      });
    } catch (err) {
      request.log.error({ err, key, uploadId }, "multipart/abort failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to abort multipart upload",
      });
    }
    return reply.code(204).send();
  });

  app.post<{
    Body: { gameId: string };
  }>("/saves/delete-game", async (request, reply) => {
    const userId = getUserId(request);
    const body = request.body as { gameId?: string };
    const gameId = body?.gameId?.trim();
    if (!gameId) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "gameId is required",
      });
    }
    try {
      await deps.deleteGameFromCloudUseCase.execute({ userId, gameId });
    } catch (err) {
      request.log.error({ err, userId, gameId }, "delete-game failed");
      return reply.status(500).send({
        error: "Internal Server Error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to delete game from cloud",
      });
    }
    return reply.code(204).send();
  });

  app.post<{
    Body: { oldGameId: string; newGameId: string };
  }>("/saves/rename-game", async (request, reply) => {
    const userId = getUserId(request);
    const body = request.body as { oldGameId?: string; newGameId?: string };
    const oldGameId = body?.oldGameId?.trim();
    const newGameId = body?.newGameId?.trim();
    if (!oldGameId || !newGameId) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "oldGameId and newGameId are required",
      });
    }
    if (oldGameId === newGameId) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "oldGameId and newGameId must be different",
      });
    }
    try {
      await deps.renameGameInCloudUseCase.execute({
        userId,
        oldGameId,
        newGameId,
      });
    } catch (err) {
      request.log.error(
        { err, userId, oldGameId, newGameId },
        "rename-game failed"
      );
      return reply.status(500).send({
        error: "Internal Server Error",
        message:
          err instanceof Error ? err.message : "Failed to rename game in cloud",
      });
    }
    return reply.code(204).send();
  });
}
