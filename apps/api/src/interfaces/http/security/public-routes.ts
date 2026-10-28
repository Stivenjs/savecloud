/**
 * Configuración centralizada de rutas públicas.
 * Este es el único lugar donde se define qué rutas son públicas
 * y no requieren autenticación.
 */

import type { FastifyRequest } from "fastify";

export const HEALTH_PATH = "/health";
export const ACCEPT_INVITE_TOKEN_PATH = "/invites/accept-token";

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

  // Endpoint de salud. Los handshakes WebSocket requieren autenticación igual que HTTP.
  if (path === HEALTH_PATH) {
    return true;
  }

  // Bootstrap sin sesión previa: el token de invitación autoriza la operación y el servidor
  // vincula la aceptación al ID local, rechazando IDs distintos en invitaciones dirigidas.
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

  // Webhook de MinIO solo queda público en Docker; en AWS lo protege API Gateway.
  if (upperMethod === "POST" && path === "/webhooks/minio" && process.env.DYNAMODB_ENDPOINT?.trim()) {
    return true;
  }

  // Todo lo demás requiere autenticación
  return false;
}
