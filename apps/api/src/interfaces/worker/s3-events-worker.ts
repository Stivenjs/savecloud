import { createDynamoDbClient } from "@infrastructure/factories/dynamoDbFactory";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { ProcessS3EventUseCase, type ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";
import { deleteS3Events, createS3EventQueueClient, receiveS3Events } from "@infrastructure/queue/s3EventQueue";

const queueUrl = process.env.S3_EVENT_QUEUE_URL?.trim();
const statsTable = process.env.GAME_STATS_TABLE?.trim();
const indexTable = process.env.SAVE_FILES_INDEX_TABLE?.trim();
if (!queueUrl || !statsTable || !indexTable) {
  throw new Error("S3_EVENT_QUEUE_URL, GAME_STATS_TABLE y SAVE_FILES_INDEX_TABLE son obligatorios para el worker.");
}
const activeQueueUrl = queueUrl;
const apiUrl = process.env.API_INTERNAL_URL?.trim() || "http://savecloud-api:3000";
const apiKey = process.env.API_KEY?.trim();
if (!apiKey) throw new Error("API_KEY es obligatorio para invalidar las cachés después del procesamiento.");
const activeApiKey = apiKey;

const dynamo = createDynamoDbClient();
const queue = createS3EventQueueClient();
const useCase = new ProcessS3EventUseCase(
  new DynamoDbSaveFileIndexRepository(dynamo, indexTable),
  new DynamoDbGameStatRepository(dynamo, statsTable)
);

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

/** Consume eventos durables y confirma el lote solo después de completar DynamoDB. */
async function run(): Promise<void> {
  console.info("[worker-eventos-s3] Worker iniciado.");
  while (!stopping) {
    try {
      const response = await receiveS3Events(queue, activeQueueUrl);
      let messages = response.Messages ?? [];
      if (messages.length === 0) continue;

      if (messages.length < 10) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const additional = await receiveS3Events(queue, activeQueueUrl, 10 - messages.length, 0);
        messages = [...messages, ...(additional.Messages ?? [])];
      }

      const events: ProcessS3EventInput[] = messages.flatMap((message) => {
        if (!message.Body) return [];
        try {
          const event: unknown = JSON.parse(message.Body);
          if (!isProcessS3EventInput(event)) return [];
          return [
            {
              ...event,
              eventTime: typeof event.eventTime === "string" ? new Date(event.eventTime) : event.eventTime,
            },
          ];
        } catch {
          return [];
        }
      });

      if (events.length === 0) {
        await deleteS3Events(queue, activeQueueUrl, messages);
        continue;
      }

      await useCase.executeBatch(events);
      const cacheResponse = await fetch(`${apiUrl}/internal/s3-events/processed`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": activeApiKey },
        body: JSON.stringify({ events }),
      });
      if (!cacheResponse.ok) {
        throw new Error(`La API rechazó la invalidación de caché (${cacheResponse.status}).`);
      }
      await deleteS3Events(queue, activeQueueUrl, messages);
    } catch (error) {
      console.error("[worker-eventos-s3] Falló el lote; SQS lo volverá a entregar.", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  queue.destroy();
  dynamo.destroy();
}

function isProcessS3EventInput(value: unknown): value is ProcessS3EventInput & { eventTime?: Date | string } {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    (event.detailType === "Object Created" || event.detailType === "Object Deleted") &&
    typeof event.s3Key === "string" &&
    (event.eventTime === undefined || typeof event.eventTime === "string" || event.eventTime instanceof Date)
  );
}

run().catch((error: unknown) => {
  console.error("[worker-eventos-s3] Error fatal.", error);
  process.exitCode = 1;
});
