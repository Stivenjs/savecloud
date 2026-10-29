import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const authRefreshRateLimit = {
  max: 20,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;

export const authUpgradeRateLimit = {
  max: 10,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;
