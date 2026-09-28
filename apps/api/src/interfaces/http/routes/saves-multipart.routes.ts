import type { FastifyInstance } from "fastify";
import {
  UploadUrlSchema,
  type UploadUrlBody,
  InitMultipartPartUrlsSchema,
  type InitMultipartPartUrlsBody,
  GetPartUrlsSchema,
  type GetPartUrlsBody,
  CompleteMultipartSchema,
  type CompleteMultipartBody,
  AbortMultipartSchema,
  type AbortMultipartBody,
  InitMultipartResponseSchema,
  InitMultipartWithPartUrlsResponseSchema,
  GetPartUrlsResponseSchema,
} from "@interfaces/schema/saves";
import type { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import type { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import type { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import type { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import type { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { getStorageUserIdFromRequest } from "@interfaces/http/helpers/saves-route-helpers";
import { getErrorMessage } from "@shared/utils";

export async function registerSavesMultipartRoutes(
  app: FastifyInstance,
  deps: {
    createMultipartUploadUseCase: CreateMultipartUploadUseCase;
    createMultipartUploadWithPartUrlsUseCase: CreateMultipartUploadWithPartUrlsUseCase;
    getUploadPartUrlsUseCase: GetUploadPartUrlsUseCase;
    completeMultipartUploadUseCase: CompleteMultipartUploadUseCase;
    abortMultipartUploadUseCase: AbortMultipartUploadUseCase;
    resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase;
  }
): Promise<void> {
  app.post<{ Body: UploadUrlBody }>(
    "/saves/multipart/init",
    { schema: { body: UploadUrlSchema, response: { 200: InitMultipartResponseSchema } } },
    async (request, reply) => {
      const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
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
    { schema: { body: InitMultipartPartUrlsSchema, response: { 200: InitMultipartWithPartUrlsResponseSchema } } },
    async (request, reply) => {
      const userId = await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase);
      const { gameId, filename, partCount } = request.body;
      const result = await deps.createMultipartUploadWithPartUrlsUseCase.execute({
        userId,
        gameId: gameId.trim(),
        filename: filename.trim(),
        partCount,
      });
      return reply.send({
        ...result,
        partUrls: result.partUrls.map((part) => ({
          partNumber: part.partNumber,
          url: part.url,
          uploadUrl: part.uploadUrl ?? part.url,
        })),
      });
    }
  );

  app.post<{ Body: GetPartUrlsBody }>(
    "/saves/multipart/part-urls",
    { schema: { body: GetPartUrlsSchema, response: { 200: GetPartUrlsResponseSchema } } },
    async (request, reply) => {
      const { key, uploadId, partNumbers } = request.body;
      const result = await deps.getUploadPartUrlsUseCase.execute({
        key: key.trim(),
        uploadId: uploadId.trim(),
        partNumbers,
      });
      return reply.send({
        partUrls: result.partUrls.map((part) => ({
          partNumber: part.partNumber,
          url: part.url,
          uploadUrl: part.uploadUrl ?? part.url,
        })),
      });
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
          parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag.trim() })),
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
        await deps.abortMultipartUploadUseCase.execute({ key: key.trim(), uploadId: uploadId.trim() });
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "multipart/abort failed");
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );
}
