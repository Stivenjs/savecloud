import type { RouteRateLimit } from "@interfaces/http/rate-limits/types";

export const publicClipRateLimit = {
  max: 60,
  timeWindow: "1 minute",
} satisfies RouteRateLimit;
