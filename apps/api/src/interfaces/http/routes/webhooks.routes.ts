import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isIgnoredS3Key, type ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";
import { parseMinioNotification } from "@interfaces/http/webhooks/minioNotificationParser";
import { invalidateEventCaches } from "@interfaces/http/helpers/saves-cache";

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: {
    processS3EventUseCase?: ProcessS3EventUseCase;
    processS3Events?: (events: ReturnType<typeof parseMinioNotification>) => Promise<void>;
  }
): Promise<void> {
  app.post("/internal/s3-events/processed", async (request, reply) => {
    const body = request.body as { events?: unknown } | undefined;
    const events = Array.isArray(body?.events) ? body.events.filter(isProcessS3EventInput) : [];
    invalidateEventCaches(events);
    return reply.code(204).send();
  });

  app.post("/webhooks/minio", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.processS3EventUseCase) {
      return reply.send({ status: "ignored", reason: "DynamoDB event indexer is disabled" });
    }

    const receivedEvents = parseMinioNotification(request.body);
    // Reutiliza el filtro del indexador antes de encolar eventos de objetos del sistema.
    const events = receivedEvents.filter((event) => !isIgnoredS3Key(event.s3Key, event.s3Key.split("/")));
    if (events.length > 0) {
      if (deps.processS3Events) {
        await deps.processS3Events(events);
        invalidateEventCaches(events);
      } else {
        await deps.processS3EventUseCase.executeBatch(events);
        invalidateEventCaches(events);
      }
    }

    return reply.send({ status: "ok", processed: events.length, ignored: receivedEvents.length - events.length });
  });
}

function isProcessS3EventInput(value: unknown): value is ReturnType<typeof parseMinioNotification>[number] {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    (event.detailType === "Object Created" || event.detailType === "Object Deleted") && typeof event.s3Key === "string"
  );
}
