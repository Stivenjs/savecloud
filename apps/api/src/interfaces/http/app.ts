import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";
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
import { GetGameSummaryUseCase } from "@application/use-cases/GetGameSummaryUseCase";
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
import { ListCloudPresenceUseCase } from "@application/use-cases/ListCloudPresenceUseCase";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import type { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { recordHttpMetric } from "@infrastructure/observability/httpMetricsStore";
import { registerSavesRoutes } from "@interfaces/http/routes/saves.routes";
import { registerShareRoutes } from "@interfaces/http/routes/share.routes";
import { registerNotificationRoutes } from "@interfaces/http/routes/notifications.routes";
import { registerInviteRoutes } from "@interfaces/http/routes/invites.routes";
import { registerProfileRoutes } from "@interfaces/http/routes/users.routes";
import { registerObservabilityRoutes } from "@interfaces/http/routes/observability.routes";
import { verifyUserAccessToken } from "@shared/accessToken";
import { isPublicRoute } from "@interfaces/http/security/public-routes";
import { GetFriendProfileUseCase } from "@application/use-cases/GetFriendProfileUseCase";

export interface AppDependencies {
  saveRepository: SaveRepository;
  saveFileIndexRepository?: SaveFileIndexRepository;
  gameStatRepository?: GameStatRepository;
  steamSeedRepository?: S3SteamSeedRepository;
  cloudInviteRepository?: CloudInviteRepository;
  shareTokenStore?: ShareTokenS3;
  notificationStore?: S3NotificationStore;
  connectionRepository?: ConnectionRepository;
}

/**
 * Crea y configura la aplicación Fastify con las rutas y casos de uso.
 * Inyección de dependencias en el punto de entrada (composition root).
 */
declare module "fastify" {
  interface FastifyRequest {
    _scMetricsStartNs?: bigint;
  }
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(import("@fastify/compress"));

  await app.register(rateLimit, {
    global: false,
    keyGenerator(request) {
      const forwarded = request.headers["x-forwarded-for"] as string | undefined;
      if (forwarded) {
        return forwarded.split(",")[0]?.trim() || "unknown";
      }
      return request.ip || "unknown";
    },
  });

  app.addHook("onRequest", async (request: FastifyRequest) => {
    request._scMetricsStartNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const start = request._scMetricsStartNs;
    if (start === undefined) return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = (request.url ?? "").split("?")[0] ?? "";
    if (path === "/health" || path === "/favicon.ico" || path.startsWith("/observability/")) return;
    const routeTemplate =
      typeof request.routeOptions?.url === "string" && request.routeOptions.url.length > 0
        ? request.routeOptions.url
        : null;
    recordHttpMetric({
      method: request.method,
      path,
      routeUrl: routeTemplate,
      statusCode: reply.statusCode,
      durationMs,
    });
  });

  const expectedApiKey = process.env.API_KEY;

  if (expectedApiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (isPublicRoute(request)) return;

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
  const listSavesUseCase = new ListSavesUseCase(deps.saveRepository, deps.saveFileIndexRepository);
  const listBackupsUseCase = new ListBackupsUseCase(deps.saveRepository);
  const deleteBackupUseCase = new DeleteBackupUseCase(deps.saveRepository);
  const renameBackupUseCase = new RenameBackupUseCase(deps.saveRepository);
  const getGameSummaryUseCase = deps.gameStatRepository
    ? new GetGameSummaryUseCase(deps.gameStatRepository)
    : undefined;
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
    getGameSummaryUseCase,
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
      listCloudPresenceUseCase: deps.connectionRepository
        ? new ListCloudPresenceUseCase(deps.cloudInviteRepository, deps.connectionRepository)
        : undefined,
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

  app.get(
    "/health",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (_, reply: FastifyReply) => {
      return reply.send({ status: "ok" });
    }
  );

  await registerObservabilityRoutes(app);

  return app;
}
