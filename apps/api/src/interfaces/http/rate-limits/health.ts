import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const healthRateLimit = {
  max: 60,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;
