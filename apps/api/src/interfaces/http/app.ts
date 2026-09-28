import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import "@fastify/websocket";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";
import type { ShareTokenRepository } from "@domain/ports/ShareTokenRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import { recordHttpMetric, summarizeHttpMetrics } from "@infrastructure/observability/httpMetricsStore";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import { registerObservabilityRoutes } from "@interfaces/http/routes/observability.routes";
import type { ClipRepository } from "@domain/ports/ClipRepository";
import { verifyUserAccessToken } from "@shared/accessToken";
import { isPublicRoute } from "@interfaces/http/security/public-routes";
import { ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";
import { registerWebhookRoutes } from "@interfaces/http/routes/webhooks.routes";
import { registerWebSocketRoutes } from "@interfaces/http/routes/websocket.routes";
import { registerNotificationsModule } from "@interfaces/http/modules/notifications";
import { registerInvitesModule } from "@interfaces/http/modules/invites";
import { registerInventoryModule } from "@interfaces/http/modules/inventory";
import { registerTrashModule } from "@interfaces/http/modules/trash";
import { registerSavesModule } from "@interfaces/http/modules/saves";
import { registerShareModule } from "@interfaces/http/modules/share";
import { registerClipsModule } from "@interfaces/http/modules/clips";

export interface AppDependencies {
  saveRepository: SaveRepository;
  saveFileIndexRepository?: SaveFileIndexRepository;
  gameStatRepository?: GameStatRepository;
  steamSeedRepository?: SteamSeedRepository;
  cloudInviteRepository?: CloudInviteRepository;
  gameInventoryRepository?: GameInventoryRepository;
  shareTokenRepository?: ShareTokenRepository;
  clipRepository?: ClipRepository;
  notificationRepository?: NotificationRepository;
  connectionRepository?: ConnectionRepository;
  webSocketNotifier?: WebSocketNotifier;
}

/**
 * Crea y configura la aplicación Fastify con las rutas y casos de uso.
 * Inyección de dependencias en el punto de entrada (composition root).
 */
declare module "fastify" {
  interface FastifyRequest {
    _scMetricsStartNs?: bigint;
    awsLambda?: {
      event?: {
        requestContext?: {
          authorizer?: {
            lambda?: Record<string, unknown>;
          };
        };
      };
    };
  }
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "warn",
    },
    disableRequestLogging: process.env.HTTP_REQUEST_LOGS !== "true",
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(import("@fastify/compress"), {
    threshold: 512,
    encodings: ["br", "gzip", "deflate"],
  });
  await app.register(import("@fastify/websocket"));

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

  registerHttpMetricsHooks(app);
  registerApiKeyAuthHook(app, process.env.API_KEY);
  const resolveCloudStorageScopeUseCase = await registerSavesModule(app, deps);

  await registerShareModule(app, {
    shareTokenRepository: deps.shareTokenRepository,
    saveRepository: deps.saveRepository,
  });

  await registerClipsModule(app, deps.clipRepository);

  await registerNotificationsModule(app, deps);
  await registerInvitesModule(app, {
    saveRepository: deps.saveRepository,
    cloudInviteRepository: deps.cloudInviteRepository,
    connectionRepository: deps.connectionRepository,
    resolveCloudStorageScopeUseCase,
  });
  await registerInventoryModule(app, deps);

  const processS3EventUseCase =
    deps.saveFileIndexRepository && deps.gameStatRepository
      ? new ProcessS3EventUseCase(deps.saveFileIndexRepository, deps.gameStatRepository)
      : undefined;

  await registerWebhookRoutes(app, { processS3EventUseCase });
  await registerWebSocketRoutes(app, { connectionRepository: deps.connectionRepository });
  await registerTrashModule(app, deps.saveRepository);

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

  await registerObservabilityRoutes(app, summarizeHttpMetrics);

  return app;
}

function registerHttpMetricsHooks(app: FastifyInstance): void {
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
}

function registerApiKeyAuthHook(app: FastifyInstance, expectedApiKey?: string): void {
  if (!expectedApiKey) return;

  app.addHook("onRequest", async (request, reply) => {
    if (isPublicRoute(request)) return;

    const rawReq = request.raw as {
      apiGateway?: { event?: { requestContext?: { authorizer?: { lambda?: Record<string, unknown> } } } };
    };
    const authorizerLambda =
      rawReq.apiGateway?.event?.requestContext?.authorizer?.lambda ??
      request.awsLambda?.event?.requestContext?.authorizer?.lambda;

    if (
      authorizerLambda &&
      (authorizerLambda.authMode || authorizerLambda.isAuthorized === true || authorizerLambda.isAuthorized === "true")
    ) {
      return;
    }

    const query = (request.query as Record<string, string> | undefined) ?? {};
    const headerKey = request.headers["x-api-key"];
    const key =
      typeof headerKey === "string" && headerKey.trim()
        ? headerKey.trim()
        : query.apiKey?.trim() || query.token?.trim();

    if (key === expectedApiKey) return;

    if (typeof key === "string" && key.trim()) {
      const token = verifyUserAccessToken(key);
      if (token) {
        const headerUserId = request.headers["x-user-id"];
        const userId =
          typeof headerUserId === "string" && headerUserId.trim() ? headerUserId.trim() : query.userId?.trim();

        if (userId && userId === token.userId) return;
      }
    }

    return reply.status(401).send({ error: "Unauthorized" });
  });
}
