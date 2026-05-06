/**
 * Lambda authorizer para API Gateway HTTP API.
 * Valida x-api-key antes de invocar la Lambda principal.
 * Formato de respuesta: 2.0 simple (isAuthorized).
 */

import { timingSafeEqual } from "crypto";
import { verifyUserAccessToken } from "@shared/accessToken";
import { isPublicHttpRoute } from "@interfaces/http/security/public-routes";

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

type AuthorizerResult = { isAuthorized: boolean };

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

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Registra y devuelve una respuesta denegada. */
function deny(reason: string, context: Record<string, string>): DenyResult {
  console.warn(JSON.stringify({ level: "WARN", authorizer: "DENIED", reason, ...context }));
  return { isAuthorized: false };
}

/** Registra un acceso concedido para auditoría. */
function allow(mode: "api-key" | "access-token" | "public", context: Record<string, string>): { isAuthorized: true } {
  if (logAuthorizerSuccess) {
    console.info(JSON.stringify({ level: "INFO", authorizer: "ALLOWED", mode, ...context }));
  }
  return { isAuthorized: true };
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

  if (expectedApiKey && safeCompare(key, expectedApiKey)) {
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

    return allow("access-token", { path: rawPath, method, userId });
  }

  return deny("invalid x-api-key/access-token", { path: rawPath, method });
}
