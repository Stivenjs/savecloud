/**
 * Lambda authorizer para API Gateway HTTP API.
 * Valida x-api-key antes de invocar la Lambda principal.
 * Formato de respuesta: 2.0 simple (isAuthorized).
 */

import { timingSafeEqual } from "crypto";
import { verifyUserAccessToken } from "@shared/accessToken";

const expectedApiKey = process.env.API_KEY ?? "";

if (!expectedApiKey) {
  console.error("[authorizer] FATAL: API_KEY env var is not set — all requests will be rejected");
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
    }
  }
  return "";
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function deny(reason: string, context: Record<string, string>): { isAuthorized: false } {
  console.warn("[authorizer] DENIED", { reason, ...context });
  return { isAuthorized: false };
}

export async function handler(event: {
  version?: string;
  type?: string;
  rawPath?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestContext?: { http?: { path?: string; method?: string } };
}): Promise<{ isAuthorized: boolean }> {
  const rawPath = event.rawPath ?? event.requestContext?.http?.path ?? "";
  const method = (event.requestContext?.http?.method ?? "").toUpperCase();

  // Rutas públicas
  if (rawPath === "/health") {
    return { isAuthorized: true };
  }

  // CORS preflight: el navegador no envía x-api-key en OPTIONS
  if (method === "OPTIONS") {
    return { isAuthorized: true };
  }

  // GET /share/:token es público (resolver link compartido sin auth)
  if (method === "GET" && rawPath.startsWith("/share/") && rawPath.length > "/share/".length) {
    return { isAuthorized: true };
  }

  // Aceptar invitación por token debe ser público (bootstrap de credenciales)
  if (method === "POST" && rawPath === "/invites/accept-token") {
    return { isAuthorized: true };
  }

  // Fallar cerrado si la env var no está configurada
  if (!expectedApiKey) {
    return deny("API_KEY not configured", { path: rawPath, method });
  }

  const key = getHeader(event.headers ?? {}, "x-api-key");

  if (!key) {
    return deny("missing x-api-key header", { path: rawPath, method });
  }

  // API key global (modo admin/host)
  if (safeCompare(key, expectedApiKey)) {
    return { isAuthorized: true };
  }

  // Access token por usuario (modo invitado): requiere que coincida con x-user-id
  const token = verifyUserAccessToken(key);
  if (token) {
    const userId = getHeader(event.headers ?? {}, "x-user-id").trim();
    if (userId && userId === token.userId) {
      return { isAuthorized: true };
    }
    return deny("x-user-id does not match access token", { path: rawPath, method });
  }

  return deny("invalid x-api-key", { path: rawPath, method });
}
