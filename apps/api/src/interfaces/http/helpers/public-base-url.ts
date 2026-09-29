import type { FastifyRequest } from "fastify";

export function getPublicBaseUrl(request: FastifyRequest): string {
  const configuredUrl = process.env.SHARE_BASE_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const forwardedProto = (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const rawHost =
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
    request.headers.host ??
    request.hostname ??
    "";
  const host = rawHost.trim();

  if (!host) {
    return "";
  }

  const isLocalHost = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|savecloud-api)(?::\d+)?$/i.test(host);

  let protocol: string;
  if (isLocalHost && forwardedProto !== "https") {
    protocol = "http";
  } else if (forwardedProto) {
    protocol = forwardedProto;
  } else {
    protocol = request.protocol || (isLocalHost ? "http" : "https");
  }

  return `${protocol}://${host}`;
}
