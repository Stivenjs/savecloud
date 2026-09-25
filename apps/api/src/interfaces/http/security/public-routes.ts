/**
 * Configuración centralizada de rutas públicas.
 * Este es el único lugar donde se define qué rutas son públicas
 * y no requieren autenticación.
 */

import type { FastifyRequest } from "fastify";

export const HEALTH_PATH = "/health";
export const SHARE_TOKEN_PATH = "/share/:token";
export const ACCEPT_INVITE_TOKEN_PATH = "/invites/accept-token";
export const SHARE_PUBLIC_URL_PREFIX = "/share/";

/**
 * Determina si una solicitud de Fastify está dirigida a una ruta pública.
 * Se usa en la capa HTTP para decisiones de middleware.
 *
 * @param request - Objeto FastifyRequest
 * @returns true si la ruta es pública (no requiere autenticación)
 */
export function isPublicRoute(request: FastifyRequest): boolean {
  const method = request.method.toUpperCase();
  const path = request.url.split("?")[0]; // Remover query string

  return isPublicHttpRoute(method, path);
}

/**
 * Determina si una solicitud HTTP (por método y ruta) está dirigida a una ruta pública.
 * Esta es la lógica central de clasificación, utilizada tanto por los manejadores HTTP
 * como por el autorizador Lambda.
 * Compartida entre la capa HTTP y Lambda para evitar duplicación.
 *
 * @param method - Método HTTP (GET, POST, OPTIONS, etc.)
 * @param path - Ruta solicitada
 * @returns true si la ruta es pública (no requiere autenticación)
 */
export function isPublicHttpRoute(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();

  // CORS preflight: siempre permitir OPTIONS
  if (upperMethod === "OPTIONS") {
    return true;
  }

  // Recursos estáticos del navegador (no requieren autenticación)
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/.well-known/security.txt") {
    return true;
  }

  // Endpoint de salud y WebSocket (monitoreo y conexión pública)
  if (path === HEALTH_PATH || path === "/" || path === "/ws") {
    return true;
  }

  // GET /share/:token es público (resolver link compartido sin autenticación)
  if (
    upperMethod === "GET" &&
    path.startsWith(SHARE_PUBLIC_URL_PREFIX) &&
    path.length > SHARE_PUBLIC_URL_PREFIX.length
  ) {
    return true;
  }

  // Aceptar invitación por token es público (bootstrap de credenciales de usuario)
  if (upperMethod === "POST" && path === ACCEPT_INVITE_TOKEN_PATH) {
    return true;
  }

  // Reproductor público de clips de vídeo y API de visualización
  if (
    upperMethod === "GET" &&
    (path.startsWith("/v/") || path.startsWith("/clip/") || path.startsWith("/api/clips/"))
  ) {
    return true;
  }

  // Webhook de MinIO (exclusivo para notificaciones de eventos en Docker)
  if (upperMethod === "POST" && path === "/webhooks/minio") {
    return true;
  }

  // Todo lo demás requiere autenticación
  return false;
}
