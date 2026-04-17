import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import { GetUploadUrlsUseCase } from "@application/use-cases/GetUploadUrlsUseCase";
import { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import { GetDownloadUrlsUseCase } from "@application/use-cases/GetDownloadUrlsUseCase";
import { DeleteGameFromCloudUseCase } from "@application/use-cases/DeleteGameFromCloudUseCase";
import { RenameGameInCloudUseCase } from "@application/use-cases/RenameGameInCloudUseCase";
import { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import { DeleteBackupUseCase } from "@application/use-cases/DeleteBackupUseCase";
import { RenameBackupUseCase } from "@application/use-cases/RenameBackupUseCase";
import { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";
import { CreateCloudInviteUseCase } from "@application/use-cases/CreateCloudInviteUseCase";
import { ListPendingCloudInvitesUseCase } from "@application/use-cases/ListPendingCloudInvitesUseCase";
import { RespondCloudInviteUseCase } from "@application/use-cases/RespondCloudInviteUseCase";
import { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { SetCloudGameShareUseCase } from "@application/use-cases/SetCloudGameShareUseCase";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import type { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { registerSavesRoutes } from "@interfaces/http/routes/saves.routes";
import { registerShareRoutes } from "@interfaces/http/routes/share.routes";
import { registerNotificationRoutes } from "@interfaces/http/routes/notifications.routes";
import { registerInviteRoutes } from "@interfaces/http/routes/invites.routes";
import { registerProfileRoutes } from "@interfaces/http/routes/users.routes";
import { verifyUserAccessToken } from "@shared/accessToken";
import { GetFriendProfileUseCase } from "@application/use-cases/GetFriendProfileUseCase";

export interface AppDependencies {
  saveRepository: SaveRepository;
  steamSeedRepository?: S3SteamSeedRepository;
  cloudInviteRepository?: CloudInviteRepository;
  shareTokenStore?: ShareTokenS3;
  notificationStore?: S3NotificationStore;
}

/**
 * Crea y configura la aplicación Fastify con las rutas y casos de uso.
 * Inyección de dependencias en el punto de entrada (composition root).
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(import("@fastify/compress"));

  const expectedApiKey = process.env.API_KEY;

  if (expectedApiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health") return;
      if (request.method === "GET" && request.url.startsWith("/share/")) return;
      if (request.method === "POST" && request.url === "/invites/accept-token") return;

      const key = request.headers["x-api-key"];
      if (key === expectedApiKey) return;

      if (typeof key === "string" && key.trim()) {
        const token = verifyUserAccessToken(key);
        if (token) {
          const userId = request.headers["x-user-id"];
          if (typeof userId === "string" && userId.trim() && userId.trim() === token.userId) return;
        }
      }

      return reply.status(401).send({ error: "Unauthorized" });
    });
  }

  const getUploadUrlUseCase = new GetUploadUrlUseCase(deps.saveRepository);
  const getUploadUrlsUseCase = new GetUploadUrlsUseCase(deps.saveRepository);
  const getDownloadUrlUseCase = new GetDownloadUrlUseCase(deps.saveRepository);
  const getDownloadUrlsUseCase = new GetDownloadUrlsUseCase(deps.saveRepository);
  const deleteGameFromCloudUseCase = new DeleteGameFromCloudUseCase(deps.saveRepository);
  const renameGameInCloudUseCase = new RenameGameInCloudUseCase(deps.saveRepository);
  const listSavesUseCase = new ListSavesUseCase(deps.saveRepository);
  const listBackupsUseCase = new ListBackupsUseCase(deps.saveRepository);
  const deleteBackupUseCase = new DeleteBackupUseCase(deps.saveRepository);
  const renameBackupUseCase = new RenameBackupUseCase(deps.saveRepository);
  const createMultipartUploadUseCase = new CreateMultipartUploadUseCase(deps.saveRepository);
  const createMultipartUploadWithPartUrlsUseCase = new CreateMultipartUploadWithPartUrlsUseCase(deps.saveRepository);
  const getUploadPartUrlsUseCase = new GetUploadPartUrlsUseCase(deps.saveRepository);
  const completeMultipartUploadUseCase = new CompleteMultipartUploadUseCase(deps.saveRepository);
  const abortMultipartUploadUseCase = new AbortMultipartUploadUseCase(deps.saveRepository);
  const resolveCloudStorageScopeUseCase = deps.cloudInviteRepository
    ? new ResolveCloudStorageScopeUseCase(deps.cloudInviteRepository)
    : undefined;

  await registerSavesRoutes(app, {
    getUploadUrlUseCase,
    getUploadUrlsUseCase,
    getDownloadUrlUseCase,
    getDownloadUrlsUseCase,
    deleteGameFromCloudUseCase,
    renameGameInCloudUseCase,
    listSavesUseCase,
    listBackupsUseCase,
    deleteBackupUseCase,
    renameBackupUseCase,
    createMultipartUploadUseCase,
    createMultipartUploadWithPartUrlsUseCase,
    getUploadPartUrlsUseCase,
    completeMultipartUploadUseCase,
    abortMultipartUploadUseCase,
    steamSeedRepository: deps.steamSeedRepository,
    resolveCloudStorageScopeUseCase,
    cloudInviteRepository: deps.cloudInviteRepository,
  });

  if (deps.shareTokenStore) {
    await registerShareRoutes(app, deps.shareTokenStore);
  }

  if (deps.notificationStore) {
    await registerNotificationRoutes(app, deps.notificationStore);
  }

  if (deps.cloudInviteRepository) {
    await registerInviteRoutes(app, {
      createCloudInviteUseCase: new CreateCloudInviteUseCase(deps.cloudInviteRepository),
      listPendingCloudInvitesUseCase: new ListPendingCloudInvitesUseCase(deps.cloudInviteRepository),
      respondCloudInviteUseCase: new RespondCloudInviteUseCase(deps.cloudInviteRepository),
      setCloudGameShareUseCase: new SetCloudGameShareUseCase(deps.cloudInviteRepository),
      cloudInviteRepository: deps.cloudInviteRepository,
    });
  }

  if (deps.cloudInviteRepository && resolveCloudStorageScopeUseCase) {
    await registerProfileRoutes(app, {
      getFriendProfileUseCase: new GetFriendProfileUseCase(
        deps.saveRepository,
        deps.cloudInviteRepository,
        resolveCloudStorageScopeUseCase
      ),
    });
  }

  app.get("/health", async (_, reply: FastifyReply) => {
    return reply.send({ status: "ok" });
  });

  return app;
}
