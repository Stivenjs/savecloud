import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";
import { parseMinioNotification } from "@interfaces/http/webhooks/minioNotificationParser";

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { processS3EventUseCase?: ProcessS3EventUseCase }
): Promise<void> {
  app.post("/webhooks/minio", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.processS3EventUseCase) {
      return reply.send({ status: "ignored", reason: "DynamoDB event indexer is disabled" });
    }

    const events = parseMinioNotification(request.body);
    if (events.length > 0) {
      await deps.processS3EventUseCase.executeBatch(events);
    }

    return reply.send({ status: "ok", processed: events.length });
  });
}
