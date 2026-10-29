/**
 * Lambda authorizer para API Gateway HTTP API.
 * Valida x-api-key antes de invocar la Lambda principal.
 * Formato de respuesta: 2.0 simple (isAuthorized).
 */

import { verifyUserAccessToken } from "@shared/accessToken";
import { isPublicHttpRoute } from "@interfaces/http/security/public-routes";
import { safeCompareSecret } from "@shared/safeCompare";

const expectedApiKey = process.env.API_KEY?.trim() ?? "";
const logAuthorizerSuccess = process.env.AUTH_LOG_SUCCESS === "true";

if (!expectedApiKey) {
  console.error("[authorizer] FATAL: API_KEY env var is not set — all requests will be rejected");
}

/** Subconjunto del evento HTTP API Gateway v2 que este authorizer necesita. */
export interface AuthorizerEvent {
  version?: string;
  type?: string;
  rawPath?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestContext?: {
    http?: { path?: string; method?: string };
  };
}

export interface AuthorizerResult {
  isAuthorized: boolean;
  context?: Record<string, string | number | boolean>;
}

type DenyResult = { isAuthorized: false };

/** Busca un header de forma case-insensitive; devuelve el primer valor o "". */
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
    }
  }
  return "";
}

/** Registra y devuelve una respuesta denegada. */
function deny(reason: string, context: Record<string, string>): DenyResult {
  console.warn(JSON.stringify({ level: "WARN", authorizer: "DENIED", reason, ...context }));
  return { isAuthorized: false };
}

/** Registra un acceso concedido para auditoría y retorna el contexto cacheable para API Gateway y Lambda. */
function allow(mode: "api-key" | "access-token" | "public", context: Record<string, string>): AuthorizerResult {
  if (logAuthorizerSuccess) {
    console.info(JSON.stringify({ level: "INFO", authorizer: "ALLOWED", mode, ...context }));
  }
  return {
    isAuthorized: true,
    context: {
      authMode: mode,
      ...context,
    },
  };
}

export async function handler(event: AuthorizerEvent): Promise<AuthorizerResult> {
  const rawPath = event.rawPath ?? event.requestContext?.http?.path ?? "";
  const method = (event.requestContext?.http?.method ?? "").toUpperCase();

  if (isPublicHttpRoute(method, rawPath)) {
    return allow("public", { path: rawPath, method });
  }

  const headers = event.headers ?? {};
  const key = getHeader(headers, "x-api-key").trim();

  if (!key) {
    return deny("missing x-api-key header", { path: rawPath, method });
  }

  if (expectedApiKey && safeCompareSecret(key, expectedApiKey)) {
    return allow("api-key", { path: rawPath, method });
  }

  if (!key.includes(".")) {
    return deny("invalid x-api-key/access-token", { path: rawPath, method });
  }

  const token = verifyUserAccessToken(key);
  if (token) {
    const userId = getHeader(headers, "x-user-id").trim();

    if (!userId) {
      return deny("x-user-id header missing for access-token auth", { path: rawPath, method });
    }

    if (userId !== token.userId) {
      return deny("x-user-id does not match access token", { path: rawPath, method });
    }
    if (!token.sessionId || !token.hostUserId) {
      return deny("access token has no active session binding", { path: rawPath, method });
    }

    return allow("access-token", {
      path: rawPath,
      method,
      userId,
      sessionId: token.sessionId,
      hostUserId: token.hostUserId,
    });
  }

  return deny("invalid x-api-key/access-token", { path: rawPath, method });
}
