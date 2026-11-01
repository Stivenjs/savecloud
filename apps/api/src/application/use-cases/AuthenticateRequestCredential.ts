import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import { verifyUserAccessToken } from "@shared/accessToken";
import { safeCompareSecret } from "@shared/safeCompare";

/** Credenciales y encabezados de identidad recibidos en una solicitud. */
export interface AuthenticateRequestCredentialInput {
  /** API key o token Bearer ya extraído del encabezado. */
  credential?: string;
  /** Identificador de usuario declarado por el cliente. */
  declaredUserId?: string;
  /** API key configurada para el servidor. */
  expectedApiKey?: string;
  /** Repositorio usado para comprobar que la sesión del token siga activa. */
  accessSessionRepository?: AccessSessionRepository;
}

/** Identidad resuelta para una credencial válida. */
export interface AuthenticatedRequestIdentity {
  /** Usuario asociado a la solicitud; una API key puede ser válida sin declarar usuario. */
  userId?: string;
  /** Clave por usuario usada por el rate limiter. */
  rateLimitUserId?: string;
}

/** Extrae la API key prioritaria o el token Bearer de encabezados HTTP. */
export function extractRequestCredential(apiKeyHeader?: string, authorizationHeader?: string): string | undefined {
  const apiKey = apiKeyHeader?.trim();
  if (apiKey) return apiKey;
  return authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
}

/**
 * Valida una API key o un token de sesión con las reglas compartidas por HTTP y WebSocket.
 *
 * @param input - Credencial, usuario declarado y dependencias de validación.
 * @returns La identidad autenticada o `null` si la credencial no es válida.
 * @throws {ApplicationError} Si un token válido está ligado a una sesión vencida o revocada.
 */
export async function authenticateRequestCredential(
  input: AuthenticateRequestCredentialInput
): Promise<AuthenticatedRequestIdentity | null> {
  const credential = input.credential?.trim();
  if (!credential) return null;

  const declaredUserId = input.declaredUserId?.trim() || undefined;
  const expectedApiKey = input.expectedApiKey?.trim();

  if (expectedApiKey && safeCompareSecret(credential, expectedApiKey)) {
    return { userId: declaredUserId, rateLimitUserId: declaredUserId };
  }

  const token = verifyUserAccessToken(credential);
  if (!token) return null;
  if (!declaredUserId || declaredUserId !== token.userId) return null;

  const session = token.sessionId ? await input.accessSessionRepository?.get(token.sessionId) : null;
  if (
    !session ||
    !session.active ||
    session.userId !== token.userId ||
    session.hostUserId !== token.hostUserId ||
    session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
  ) {
    throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada.");
  }

  return { userId: token.userId, rateLimitUserId: token.userId };
}
