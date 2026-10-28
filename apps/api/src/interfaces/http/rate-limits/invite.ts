import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const inviteCreationRateLimit = {
  max: 30,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.scRateLimitUserId;
    return userId ? `user:${userId}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;

export const inviteAcceptanceRateLimit = {
  max: 10,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;
