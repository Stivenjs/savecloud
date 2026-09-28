import type { FastifyInstance } from "fastify";
import {
  SteamSeedManifestUploadUrlSchema,
  type SteamSeedManifestUploadUrlBody,
  SteamSeedBatchDownloadUrlSchema,
  type SteamSeedBatchDownloadUrlBody,
  SteamSeedBatchesQuerySchema,
  type SteamSeedBatchesQuery,
  SteamSeedWorkerControlSchema,
  type SteamSeedWorkerControlBody,
} from "@interfaces/schema/saves";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { getStorageUserIdFromRequest, ownerIdFromStorageUserId } from "@interfaces/http/helpers/saves-route-helpers";
import { getErrorMessage, getUserId } from "@shared/utils";

export async function registerSteamSeedRoutes(
  app: FastifyInstance,
  deps: {
    steamSeedRepository?: SteamSeedRepository;
    resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase;
  }
): Promise<void> {
  app.post<{ Body: SteamSeedManifestUploadUrlBody }>(
    "/saves/steam-seed/manifest/upload-url",
    { schema: { body: SteamSeedManifestUploadUrlSchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }
      const ownerId = ownerIdFromStorageUserId(
        await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
      );
      const result = await deps.steamSeedRepository.getManifestUploadUrl(ownerId, request.body.partIndex);
      return reply.send(result);
    }
  );

  app.post("/saves/steam-seed/priority/upload-url", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    const ownerId = ownerIdFromStorageUserId(
      await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
    );
    const result = await deps.steamSeedRepository.getPriorityUploadUrl(ownerId);
    return reply.send(result);
  });

  app.post("/saves/steam-seed/priority/download-url", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    const ownerId = ownerIdFromStorageUserId(
      await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
    );
    const downloadUrl = await deps.steamSeedRepository.getPriorityDownloadUrl(ownerId);
    return reply.send({ downloadUrl });
  });

  app.post("/saves/steam-seed/tick", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    try {
      const { handler: seedHandler } = await import("@interfaces/lambda/steam-seed/handler");
      const requesterUserId = getUserId(request);
      const ownerId = ownerIdFromStorageUserId(
        await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
      );
      if (requesterUserId !== ownerId) {
        return reply
          .status(403)
          .send({ error: "Forbidden", message: "Only the cloud owner can manage the Steam worker" });
      }
      const result = await seedHandler({ ownerId });
      return reply.send(result);
    } catch (err: unknown) {
      request.log.error({ err }, "steam-seed tick failed");
      return reply.status(500).send({ error: "Internal Server Error", message: String(err) });
    }
  });

  app.post("/saves/steam-seed/reset", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    const requesterUserId = getUserId(request);
    const ownerId = ownerIdFromStorageUserId(
      await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
    );
    if (requesterUserId !== ownerId) {
      return reply
        .status(403)
        .send({ error: "Forbidden", message: "Only the cloud owner can manage the Steam worker" });
    }
    await deps.steamSeedRepository.resetState(ownerId);
    return reply.status(204).send();
  });

  app.get("/saves/steam-seed/status", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    const ownerId = ownerIdFromStorageUserId(
      await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
    );
    const out = await deps.steamSeedRepository.getSteamSeedStatus(ownerId);
    return reply.send(out);
  });

  app.get("/saves/steam-seed/control", async (request, reply) => {
    if (!deps.steamSeedRepository) {
      return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
    }
    const requesterUserId = getUserId(request);
    const ownerId = ownerIdFromStorageUserId(
      await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
    );
    if (requesterUserId !== ownerId) {
      return reply
        .status(403)
        .send({ error: "Forbidden", message: "Only the cloud owner can manage the Steam worker" });
    }
    const [worker, progress, reviews] = await Promise.all([
      deps.steamSeedRepository.getWorkerControl(ownerId),
      deps.steamSeedRepository.getSteamSeedStatus(ownerId),
      deps.steamSeedRepository.getSteamReviewsSeedStatus(ownerId),
    ]);
    return reply.send({ ...worker, ...progress, reviews });
  });

  app.put<{ Body: SteamSeedWorkerControlBody }>(
    "/saves/steam-seed/control",
    { schema: { body: SteamSeedWorkerControlSchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }
      const requesterUserId = getUserId(request);
      const ownerId = ownerIdFromStorageUserId(
        await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
      );
      if (requesterUserId !== ownerId) {
        return reply
          .status(403)
          .send({ error: "Forbidden", message: "Only the cloud owner can manage the Steam worker" });
      }
      const control = await deps.steamSeedRepository.setWorkerPaused(ownerId, request.body.paused);
      const [progress, reviews] = await Promise.all([
        deps.steamSeedRepository.getSteamSeedStatus(ownerId),
        deps.steamSeedRepository.getSteamReviewsSeedStatus(ownerId),
      ]);
      return reply.send({ ...control, ...progress, reviews });
    }
  );

  app.get<{ Querystring: SteamSeedBatchesQuery }>(
    "/saves/steam-seed/batches",
    { schema: { querystring: SteamSeedBatchesQuerySchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }
      const ownerId = ownerIdFromStorageUserId(
        await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
      );
      const maxKeys = request.query.maxKeys ?? 200;
      const out = await deps.steamSeedRepository.listBatchKeys(ownerId, maxKeys, request.query.cursor);
      return reply.send(out);
    }
  );

  app.get<{ Querystring: SteamSeedBatchesQuery }>(
    "/saves/steam-seed/reviews/batches",
    { schema: { querystring: SteamSeedBatchesQuerySchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }
      const ownerId = ownerIdFromStorageUserId(
        await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
      );
      const maxKeys = request.query.maxKeys ?? 200;
      const out = await deps.steamSeedRepository.listReviewBatchKeys(ownerId, maxKeys, request.query.cursor);
      return reply.send(out);
    }
  );

  app.post<{ Body: SteamSeedBatchDownloadUrlBody }>(
    "/saves/steam-seed/batch/download-url",
    { schema: { body: SteamSeedBatchDownloadUrlSchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }

      const { key, keys } = request.body;
      if (!key && (!keys || keys.length === 0)) {
        return reply.status(400).send({ error: "Bad Request", message: "either 'key' or 'keys' is required" });
      }

      try {
        const ownerId = ownerIdFromStorageUserId(
          await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
        );

        // Bulk mode: keys array
        if (keys) {
          const results = await deps.steamSeedRepository.getBatchDownloadUrl(ownerId, keys);
          return reply.send({ results });
        }

        const downloadUrl = await deps.steamSeedRepository.getBatchDownloadUrl(ownerId, key!.trim());
        return reply.send({ downloadUrl });
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.startsWith("Invalid key:")) {
          return reply.status(400).send({ error: "Bad Request", message });
        }
        request.log.error({ err }, "steam-seed batch download-url failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: SteamSeedBatchDownloadUrlBody }>(
    "/saves/steam-seed/reviews/batch/download-url",
    { schema: { body: SteamSeedBatchDownloadUrlSchema } },
    async (request, reply) => {
      if (!deps.steamSeedRepository) {
        return reply.status(501).send({ error: "Not Implemented", message: "steam seed repository unavailable" });
      }

      const { key, keys } = request.body;
      if (!key && (!keys || keys.length === 0)) {
        return reply.status(400).send({ error: "Bad Request", message: "either 'key' or 'keys' is required" });
      }

      try {
        const ownerId = ownerIdFromStorageUserId(
          await getStorageUserIdFromRequest(request, deps.resolveCloudStorageScopeUseCase)
        );

        if (keys) {
          const results = await deps.steamSeedRepository.getBatchDownloadUrl(ownerId, keys);
          return reply.send({ results });
        }

        const downloadUrl = await deps.steamSeedRepository.getBatchDownloadUrl(ownerId, key!.trim());
        return reply.send({ downloadUrl });
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.startsWith("Invalid key:")) {
          return reply.status(400).send({ error: "Bad Request", message });
        }
        request.log.error({ err }, "steam-seed reviews batch download-url failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );
}
