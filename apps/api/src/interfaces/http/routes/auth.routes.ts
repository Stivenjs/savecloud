import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import { getBootstrapUserId } from "@interfaces/http/helpers/request-context";
import { verifyLegacyUserAccessToken } from "@shared/accessToken";
import { createAccessSession, rotateAccessSession } from "@shared/accessSession";
import { authRefreshRateLimit, authUpgradeRateLimit } from "@interfaces/http/rate-limits/auth";
import { RefreshBody } from "@interfaces/schema/auth";
import { TtlCache } from "@shared/ttlCache";

/**
 * Caché en memoria TTL (por instancia de proceso) para el estado de actividad de membresías.
 * Evita consultas redundantes a DynamoDB en ráfagas de renovación y ciclos periódicos (~5 min).
 * TTL de 30 segundos: mantiene frescura y permite revocaciones oportunas.
 */
const activeMembershipCache = new TtlCache<string, boolean>({ ttlMs: 30_000, maxEntries: 1_000 });

/**
 * Invalida el estado en caché de la membresía para un par host/miembro.
 * Útil para purgas explícitas ante eventos de revocación en tiempo real.
 *
 * @param hostUserId - Identificador del host propietario de la nube.
 * @param memberUserId - Identificador del miembro cuya membresía cambió.
 */
export function invalidateMembershipAuthCache(hostUserId: string, memberUserId: string): void {
  activeMembershipCache.delete(`${hostUserId.trim()}::${memberUserId.trim()}`);
}

/**
 * Dependencias requeridas para registrar las rutas de autenticación y renovación de sesiones.
 */
export interface AuthRouteDependencies {
  /** Repositorio para la gestión del ciclo de vida y rotación de sesiones de acceso. */
  accessSessionRepository?: AccessSessionRepository;
  /** Repositorio de membresías e invitaciones de nube compartida. */
  cloudInviteRepository?: CloudInviteRepository;
}

/**
 * Registra los endpoints HTTP de autenticación, renovación rotativa de sesiones y migración de tokens legados.
 *
 * Rutas registradas:
 * - `POST /auth/refresh`: Renueva atómicamente un token de acceso y rota su refresh token (RFC 6749).
 * - `POST /auth/upgrade`: Migra credenciales heredadas (`sc1`) a sesiones rotativas modernas (`sc2`).
 *
 * @param app - Instancia del servidor HTTP Fastify.
 * @param deps - Dependencias de infraestructura y persistencia inyectadas.
 */
export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDependencies): Promise<void> {
  /**
   * Renovación y rotación atómica de sesión.
   *
   * Valida la firma y no reutilización del refresh token, verifica la membresía activa
   * en la nube y emite un nuevo par (access token + refresh token rotado).
   */
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
          const cacheKey = `${session.hostUserId}::${session.userId}`;
          const cached = activeMembershipCache.get(cacheKey);
          if (cached !== null) {
            return cached;
          }

          const membership = await deps.cloudInviteRepository!.getMembership(session.hostUserId, session.userId);
          const isActive = membership?.active === true;
          if (isActive) {
            activeMembershipCache.set(cacheKey, true);
          }
          return isActive;
        }
      );

      if (!tokens) {
        throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada. Acepta una nueva invitación.");
      }

      return reply.send(tokens);
    }
  );

  /**
   * Migración de credenciales sc1 ya instaladas.
   *
   * El token legado se acepta únicamente para esta operación única y se reemplaza
   * por una sesión revocable moderna sc2 con refresh token rotativo.
   */
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
