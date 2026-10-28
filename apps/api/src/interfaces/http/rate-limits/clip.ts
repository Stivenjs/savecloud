import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const publicClipRateLimit = {
  max: 60,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;

export const clipUploadUrlRateLimit = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.headers["x-user-id"];
    return typeof userId === "string" && userId.trim() ? `user:${userId.trim()}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;
