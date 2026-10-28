import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const publicShareRateLimit = {
  max: 30,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;
