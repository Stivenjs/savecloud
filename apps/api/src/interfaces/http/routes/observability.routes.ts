import type { FastifyInstance } from "fastify";
import { summarizeHttpMetrics, type ObservabilitySummaryDto } from "@infrastructure/observability/httpMetricsStore";

export async function registerObservabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { window?: string }; Reply: ObservabilitySummaryDto }>(
    "/observability/desktop/summary",
    async (request, reply) => {
      const window = request.query.window ?? "15m";
      const summary = summarizeHttpMetrics(window);
      return reply.send(summary);
    }
  );
}
