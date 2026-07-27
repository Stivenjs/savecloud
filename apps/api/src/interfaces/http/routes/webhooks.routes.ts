import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";

export function parseMinioNotification(body: any): Array<{
  detailType: "Object Created" | "Object Deleted";
  s3Key: string;
  size?: number;
  eventTime?: Date;
}> {
  if (!body || typeof body !== "object") return [];

  const results: Array<{
    detailType: "Object Created" | "Object Deleted";
    s3Key: string;
    size?: number;
    eventTime?: Date;
  }> = [];

  const records = Array.isArray(body.Records) ? body.Records : [body];
  const bucketName = process.env.BUCKET_NAME || "savecloud-saves";

  for (const rec of records) {
    let rawKey: string = rec?.s3?.object?.key || rec?.Key || body.Key || "";
    if (!rawKey) continue;

    let decodedKey = decodeURIComponent(rawKey.replace(/\+/g, " "));

    if (decodedKey.startsWith(`${bucketName}/`)) {
      decodedKey = decodedKey.slice(bucketName.length + 1);
    }

    const eventName: string = rec?.eventName || body.EventName || "";
    let detailType: "Object Created" | "Object Deleted" = "Object Created";

    if (eventName.toLowerCase().includes("delete") || eventName.toLowerCase().includes("removed")) {
      detailType = "Object Deleted";
    } else {
      detailType = "Object Created";
    }

    const size = typeof rec?.s3?.object?.size === "number" ? rec.s3.object.size : undefined;
    const eventTime = rec?.eventTime ? new Date(rec.eventTime) : undefined;

    results.push({
      detailType,
      s3Key: decodedKey,
      size,
      eventTime,
    });
  }

  return results;
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { processS3EventUseCase?: ProcessS3EventUseCase }
): Promise<void> {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.processS3EventUseCase) {
      return reply.send({ status: "ignored", reason: "DynamoDB event indexer is disabled" });
    }

    const events = parseMinioNotification(request.body);
    for (const event of events) {
      await deps.processS3EventUseCase.execute(event);
    }

    return reply.send({ status: "ok", processed: events.length });
  };

  app.post("/webhooks/minio", handler);
}
