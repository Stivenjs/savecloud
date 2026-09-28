import type { FastifyRequest } from "fastify";

export function getPublicBaseUrl(request: FastifyRequest): string {
  const configuredUrl = process.env.SHARE_BASE_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const protocol = (request.headers["x-forwarded-proto"] as string) || "https";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "";
  return `${protocol}://${host}`;
}
