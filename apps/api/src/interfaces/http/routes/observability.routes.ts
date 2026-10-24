import type { FastifyInstance } from "fastify";

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  summarizeMetrics: (window: string) => object,
  getActiveWebSocketConnectionCount?: () => number
): Promise<void> {
  app.get<{ Querystring: { window?: string } }>("/observability/desktop/summary", async (request, reply) => {
    const window = request.query.window ?? "15m";
    const summary = summarizeMetrics(window);
    const activeConnections = getActiveWebSocketConnectionCount?.() ?? null;
    return reply.send({
      ...summary,
      websocket: {
        activeConnections,
        scope: activeConnections === null ? "unavailable" : "api_process",
      },
    });
  });
}
