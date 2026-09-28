import type { FastifyInstance } from "fastify";

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  summarizeMetrics: (window: string) => unknown
): Promise<void> {
  app.get<{ Querystring: { window?: string } }>("/observability/desktop/summary", async (request, reply) => {
    const window = request.query.window ?? "15m";
    const summary = summarizeMetrics(window);
    return reply.send(summary);
  });
}
