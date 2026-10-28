import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
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
import { shouldIgnoreHttpObservation } from "@infrastructure/observability/httpRoutePolicy";
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
import { registerHttpErrorHandler } from "@interfaces/http/error-handler";
import { healthRateLimit } from "@interfaces/http/rate-limits/health";
import { ApplicationError } from "@application/errors/ApplicationError";
import { resolveHttpLoggingConfig } from "@interfaces/http/helpers/http-logging";

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
  getActiveWebSocketConnectionCount?: () => number;
  processS3Events?: (
    events: import("@application/use-cases/ProcessS3EventUseCase").ProcessS3EventInput[]
  ) => Promise<void>;
}

/**
 * Crea y configura la aplicación Fastify con las rutas y casos de uso.
 * Inyección de dependencias en el punto de entrada (composition root).
 */
declare module "fastify" {
  interface FastifyRequest {
    _scMetricsStartNs?: bigint;
    scAuthenticatedUserId?: string;
    scRateLimitUserId?: string;
    awsLambda?: {
      event?: {
        requestContext?: {
          http?: { sourceIp?: string };
          authorizer?: {
            lambda?: Record<string, unknown>;
          };
        };
      };
    };
  }
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const loggingConfig = resolveHttpLoggingConfig();

  const app = Fastify({
    logger: {
      level: loggingConfig.level,
    },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy:
      process.env.TRUSTED_PROXY_CIDRS?.split(",")
        .map((cidr) => cidr.trim())
        .filter(Boolean) ?? false,
  });

  await app.register(cors, { origin: true });
  await app.register(import("@fastify/compress"), {
    threshold: 512,
    encodings: ["br", "gzip", "deflate"],
  });
  await app.register(import("@fastify/websocket"));
  registerHttpErrorHandler(app);

  await app.register(rateLimit, {
    global: false,
    keyGenerator(request) {
      const lambdaSourceIp = request.awsLambda?.event?.requestContext?.http?.sourceIp;
      if (lambdaSourceIp) return `ip:${lambdaSourceIp}`;
      return request.ip || "unknown";
    },
  });

  registerHttpMetricsHooks(app, loggingConfig.requestLoggingEnabled);
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

  await registerWebhookRoutes(app, { processS3EventUseCase, processS3Events: deps.processS3Events });
  await registerWebSocketRoutes(app, { connectionRepository: deps.connectionRepository });
  await registerTrashModule(app, deps.saveRepository);

  app.get(
    "/health",
    {
      config: { rateLimit: healthRateLimit },
    },
    async (_, reply: FastifyReply) => {
      return reply.send({ status: "ok" });
    }
  );

  await registerObservabilityRoutes(app, summarizeHttpMetrics, deps.getActiveWebSocketConnectionCount);

  return app;
}

function registerHttpMetricsHooks(app: FastifyInstance, requestLoggingEnabled: boolean): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request._scMetricsStartNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const start = request._scMetricsStartNs;
    if (start === undefined) return;

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = (request.url ?? "").split("?")[0] ?? "";
    const ignoreObservation = shouldIgnoreHttpObservation(path);
    const routeTemplate =
      typeof request.routeOptions?.url === "string" && request.routeOptions.url.length > 0
        ? request.routeOptions.url
        : null;

    if (requestLoggingEnabled && !ignoreObservation) {
      request.log.info(
        {
          method: request.method,
          route: routeTemplate ?? "<ruta-no-encontrada>",
          statusCode: reply.statusCode,
          durationMs: Number(durationMs.toFixed(2)),
        },
        "Solicitud HTTP completada"
      );
    }

    if (ignoreObservation) return;

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
      const authorizedUserId = authorizerLambda.userId;
      if (typeof authorizedUserId === "string" && authorizedUserId.trim()) {
        request.scAuthenticatedUserId = authorizedUserId.trim();
        if (authorizerLambda.authMode === "access-token") {
          request.scRateLimitUserId = authorizedUserId.trim();
        }
      } else if (authorizerLambda.authMode === "api-key") {
        const declaredUserId = request.headers["x-user-id"];
        request.scAuthenticatedUserId = typeof declaredUserId === "string" ? declaredUserId.trim() : undefined;
      }
      return;
    }

    const headerKey = request.headers["x-api-key"];
    const authorization = request.headers.authorization;
    const bearer = typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
    const key = typeof headerKey === "string" && headerKey.trim() ? headerKey.trim() : bearer?.trim();

    if (expectedApiKey && key === expectedApiKey) {
      const declaredUserId = request.headers["x-user-id"];
      request.scAuthenticatedUserId = typeof declaredUserId === "string" ? declaredUserId.trim() : undefined;
      return;
    }

    if (typeof key === "string" && key.trim()) {
      const token = verifyUserAccessToken(key);
      if (token) {
        const headerUserId = request.headers["x-user-id"];
        const userId = typeof headerUserId === "string" ? headerUserId.trim() : "";

        if (userId && userId === token.userId) {
          request.scAuthenticatedUserId = token.userId;
          request.scRateLimitUserId = token.userId;
          return;
        }
      }
    }

    throw new ApplicationError("UNAUTHENTICATED", "No autorizado.");
  });
}
