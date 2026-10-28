import type { FastifyContextConfig } from "fastify";

export type RouteRateLimit = Exclude<NonNullable<FastifyContextConfig["rateLimit"]>, false>;
