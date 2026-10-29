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

export const memberRemovalRateLimit = {
  max: 20,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.scRateLimitUserId;
    return userId ? `user:${userId}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;

export const memberCancelRemovalRateLimit = {
  max: 20,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.scRateLimitUserId;
    return userId ? `user:${userId}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;

export const membershipLeaveRateLimit = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator(request) {
    const userId = request.scRateLimitUserId;
    return userId ? `user:${userId}` : `ip:${request.ip || "unknown"}`;
  },
} satisfies RouteRateLimit;
