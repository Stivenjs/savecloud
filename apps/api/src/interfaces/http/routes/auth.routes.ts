import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import { getBootstrapUserId } from "@interfaces/http/helpers/request-context";
import { verifyLegacyUserAccessToken } from "@shared/accessToken";
import { createAccessSession, rotateAccessSession } from "@shared/accessSession";
import { authRefreshRateLimit, authUpgradeRateLimit } from "@interfaces/http/rate-limits/auth";

const RefreshBody = Type.Object({ refreshToken: Type.String({ minLength: 1, maxLength: 256 }) });

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    accessSessionRepository?: AccessSessionRepository;
    cloudInviteRepository?: CloudInviteRepository;
  }
): Promise<void> {
  app.post<{ Body: { refreshToken: string } }>(
    "/auth/refresh",
    { schema: { body: RefreshBody }, config: { rateLimit: authRefreshRateLimit } },
    async (request, reply: FastifyReply) => {
      if (!deps.accessSessionRepository || !deps.cloudInviteRepository) {
        throw new ApplicationError("SERVICE_UNAVAILABLE", "La renovación de sesiones no está disponible.");
      }
      const tokens = await rotateAccessSession(
        deps.accessSessionRepository,
        request.body.refreshToken,
        async (session) => {
          const membership = await deps.cloudInviteRepository!.getMembership(session.hostUserId, session.userId);
          return membership?.active === true;
        }
      );
      if (!tokens)
        throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada. Acepta una nueva invitación.");
      return reply.send(tokens);
    }
  );

  // Migra credenciales sc1 ya instaladas. El token legado se acepta solo para
  // esta operación y se reemplaza por una sesión revocable sc2.
  app.post("/auth/upgrade", { config: { rateLimit: authUpgradeRateLimit } }, async (request, reply: FastifyReply) => {
    if (!deps.accessSessionRepository || !deps.cloudInviteRepository) {
      throw new ApplicationError("SERVICE_UNAVAILABLE", "La migración de sesiones no está disponible.");
    }
    const userId = getBootstrapUserId(request);
    const headerKey = request.headers["x-api-key"];
    const authorization = request.headers.authorization;
    const bearer = typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
    const legacyCredential = typeof headerKey === "string" ? headerKey : (bearer ?? "");
    const legacy = verifyLegacyUserAccessToken(legacyCredential);
    if (!legacy || legacy.userId !== userId) {
      throw new ApplicationError("UNAUTHENTICATED", "La credencial anterior no es válida.");
    }

    const memberships = (await deps.cloudInviteRepository.listMembershipsForMember(userId)).filter(
      (membership) => membership.active
    );
    if (memberships.length !== 1) {
      throw new ApplicationError(
        "CONFLICT",
        "No se pudo identificar una única nube activa para migrar. Acepta nuevamente la invitación."
      );
    }
    const tokens = await createAccessSession(deps.accessSessionRepository, userId, memberships[0]!.hostUserId);
    return reply.send(tokens);
  });
}
