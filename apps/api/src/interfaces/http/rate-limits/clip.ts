import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const publicClipRateLimit = {
  max: 60,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;

export const clipUploadUrlRateLimit = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.scRateLimitUserId;
    return userId ? `user:${userId}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;
