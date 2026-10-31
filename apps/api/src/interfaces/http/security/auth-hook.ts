import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import { verifyUserAccessToken } from "@shared/accessToken";
import { safeCompareSecret } from "@shared/safeCompare";
import { isPublicRoute } from "@interfaces/http/security/public-routes";

declare module "fastify" {
  interface FastifyRequest {
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

/**
 * Registra el hook global de autenticación `onRequest` de Fastify.
 *
 * Determina si la petición entrante está autorizada evaluando secuencialmente:
 * 1. Rutas públicas excluidas de autenticación (`isPublicRoute`).
 * 2. Contexto de autorización previo emitido por AWS Lambda Authorizer en API Gateway.
 * 3. API Key maestra del servidor (`x-api-key` o `Authorization: Bearer <key>`).
 * 4. Token de sesión de usuario autenticado (`Authorization: Bearer <token>` junto a `x-user-id`).
 *
 * @param app - Instancia principal de Fastify donde se registrará el hook.
 * @param expectedApiKey - Clave API maestra esperada (`process.env.API_KEY`).
 * @param accessSessionRepository - Repositorio para la consulta y validación del ciclo de vida de sesiones activas.
 */
export function registerApiKeyAuthHook(
  app: FastifyInstance,
  expectedApiKey?: string,
  accessSessionRepository?: AccessSessionRepository
): void {
  app.addHook("onRequest", async (request) => {
    if (isPublicRoute(request)) return;

    const handledLambda = await handleLambdaAuthorizer(request, accessSessionRepository);
    if (handledLambda) return;

    const key = extractCredential(request);

    if (expectedApiKey && safeCompareSecret(key ?? "", expectedApiKey)) {
      const declaredUserId = request.headers["x-user-id"];
      request.scAuthenticatedUserId = typeof declaredUserId === "string" ? declaredUserId.trim() : undefined;
      request.scRateLimitUserId = request.scAuthenticatedUserId;
      return;
    }

    if (typeof key === "string" && key.trim()) {
      const handledUserSession = await handleUserSessionToken(request, key.trim(), accessSessionRepository);
      if (handledUserSession) return;
    }

    throw new ApplicationError("UNAUTHENTICATED", "No autorizado.");
  });
}

/**
 * Extrae la credencial enviada en la solicitud HTTP.
 *
 * Inspecciona prioritariamente la cabecera `x-api-key`. Si no está presente,
 * extrae el valor tras el prefijo `Bearer ` de la cabecera `Authorization`.
 *
 * @param request - Solicitud HTTP de Fastify en curso.
 * @returns El token o clave extraída si está presente, o `undefined` en caso contrario.
 */
function extractCredential(request: FastifyRequest): string | undefined {
  const headerKey = request.headers["x-api-key"];
  const authorization = request.headers.authorization;
  const bearer = typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
  return typeof headerKey === "string" && headerKey.trim() ? headerKey.trim() : bearer?.trim();
}

/**
 * Procesa la información de autorización inyectada por un Lambda Authorizer en AWS API Gateway.
 *
 * Soporta dos modos de autorización:
 * - `access-token`: Verifica que la sesión del usuario exista, permanezca activa, no haya expirado
 *   y coincida exactamente con el usuario y anfitrión autorizados.
 * - `api-key`: Asocia el identificador de usuario declarado en la cabecera `x-user-id`.
 *
 * @param request - Solicitud HTTP de Fastify en curso.
 * @param accessSessionRepository - Repositorio de sesiones de acceso para validar sesiones de usuario.
 * @returns `true` si la solicitud contenía un contexto de autorizador Lambda procesado, `false` de lo contrario.
 * @throws {ApplicationError} Si el modo es `access-token` y la sesión es inválida, expiró o fue revocada.
 */
async function handleLambdaAuthorizer(
  request: FastifyRequest,
  accessSessionRepository?: AccessSessionRepository
): Promise<boolean> {
  const rawReq = request.raw as {
    apiGateway?: { event?: { requestContext?: { authorizer?: { lambda?: Record<string, unknown> } } } };
  };
  const authorizerLambda =
    rawReq.apiGateway?.event?.requestContext?.authorizer?.lambda ??
    request.awsLambda?.event?.requestContext?.authorizer?.lambda;

  if (!authorizerLambda || (!authorizerLambda.authMode && authorizerLambda.isAuthorized !== true)) {
    return false;
  }

  const authorizedUserId = authorizerLambda.userId;
  if (typeof authorizedUserId === "string" && authorizedUserId.trim()) {
    if (authorizerLambda.authMode === "access-token") {
      const sessionId = authorizerLambda.sessionId;
      const hostUserId = authorizerLambda.hostUserId;
      if (typeof sessionId !== "string" || typeof hostUserId !== "string" || !accessSessionRepository) {
        throw new ApplicationError("UNAUTHENTICATED", "La sesión del usuario no es válida.");
      }
      const session = await accessSessionRepository.get(sessionId);
      if (
        !session ||
        !session.active ||
        session.userId !== authorizedUserId.trim() ||
        session.hostUserId !== hostUserId.trim() ||
        session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
      ) {
        throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada.");
      }
    }
    request.scAuthenticatedUserId = authorizedUserId.trim();
    if (authorizerLambda.authMode === "access-token") {
      request.scRateLimitUserId = authorizedUserId.trim();
    }
  } else if (authorizerLambda.authMode === "api-key") {
    const declaredUserId = request.headers["x-user-id"];
    request.scAuthenticatedUserId = typeof declaredUserId === "string" ? declaredUserId.trim() : undefined;
  }

  return true;
}

/**
 * Valida un token de acceso criptográfico (JWT/HMAC) y confirma el estado activo de su sesión.
 *
 * Comprueba que la firma del token sea legítima, que el `x-user-id` declarado coincida con
 * el sujeto del token, y que la sesión vinculada permanezca activa y no haya vencido en el almacén de datos.
 *
 * @param request - Solicitud HTTP de Fastify en curso.
 * @param tokenString - Cadena de texto que contiene el token de acceso Bearer.
 * @param accessSessionRepository - Repositorio de sesiones de acceso.
 * @returns `true` si el token y la sesión fueron validados con éxito, `false` si el token o el usuario no coinciden.
 * @throws {ApplicationError} Si el token es sintácticamente válido pero su sesión fue revocada o expiró.
 */
async function handleUserSessionToken(
  request: FastifyRequest,
  tokenString: string,
  accessSessionRepository?: AccessSessionRepository
): Promise<boolean> {
  const token = verifyUserAccessToken(tokenString);
  if (!token) return false;

  const headerUserId = request.headers["x-user-id"];
  const userId = typeof headerUserId === "string" ? headerUserId.trim() : "";

  if (!userId || userId !== token.userId) {
    return false;
  }

  const session = token.sessionId ? await accessSessionRepository?.get(token.sessionId) : null;
  if (
    !session ||
    !session.active ||
    session.userId !== token.userId ||
    session.hostUserId !== token.hostUserId ||
    session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
  ) {
    throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada.");
  }

  request.scAuthenticatedUserId = token.userId;
  request.scRateLimitUserId = token.userId;
  return true;
}
