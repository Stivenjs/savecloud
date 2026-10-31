import { createDynamoDbClient } from "@infrastructure/factories/dynamoDbFactory";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import {
  PostgresGameStatRepository,
  ensurePostgresGameStatSchema,
} from "@infrastructure/persistence/PostgresGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import {
  ensurePostgresSaveFileIndexSchema,
  PostgresSaveFileIndexRepository,
} from "@infrastructure/persistence/PostgresSaveFileIndexRepository";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";
import { ProcessS3EventUseCase, type ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";
import { deleteS3Events, createS3EventQueueClient, receiveS3Events } from "@infrastructure/queue/s3EventQueue";

const queueUrl = process.env.S3_EVENT_QUEUE_URL?.trim();
const statsTable = process.env.GAME_STATS_TABLE?.trim();
const indexTable = process.env.SAVE_FILES_INDEX_TABLE?.trim();
const databaseConfiguration = readDatabaseConfiguration();

if (!queueUrl || (!databaseConfiguration && (!statsTable || !indexTable))) {
  throw new Error("S3_EVENT_QUEUE_URL y los almacenes necesarios son obligatorios para el worker.");
}

const activeQueueUrl = queueUrl;
const apiUrl = process.env.API_INTERNAL_URL?.trim() || "http://savecloud-api:3000";
const apiKey = process.env.API_KEY?.trim();

if (!apiKey) {
  throw new Error("API_KEY es obligatorio para invalidar las cachés después del procesamiento.");
}

const activeApiKey = apiKey;

const database = databaseConfiguration ? createDatabaseClient(databaseConfiguration) : undefined;
const dynamo = database ? undefined : createDynamoDbClient();
const queue = createS3EventQueueClient();

let saveFileIndexRepository: PostgresSaveFileIndexRepository | DynamoDbSaveFileIndexRepository;

if (database) {
  saveFileIndexRepository = new PostgresSaveFileIndexRepository(database);
} else if (indexTable) {
  saveFileIndexRepository = new DynamoDbSaveFileIndexRepository(dynamo!, indexTable);
} else {
  throw new Error("Falta DATABASE_* o SAVE_FILES_INDEX_TABLE para el almacén del índice de archivos.");
}

const gameStatRepository = database
  ? new PostgresGameStatRepository(database)
  : new DynamoDbGameStatRepository(dynamo!, statsTable!);

const useCase = new ProcessS3EventUseCase(saveFileIndexRepository, gameStatRepository);

let stopping = false;

process.on("SIGTERM", () => {
  stopping = true;
});

process.on("SIGINT", () => {
  stopping = true;
});

/**
 * Analiza y valida un mensaje de evento S3 sin descartar silenciosamente
 * aquellos que contengan información incorrecta.
 */
function parseS3EventMessage<TMessage extends { Body?: string; MessageId?: string }>(
  message: TMessage
): { message: TMessage; event: ProcessS3EventInput } | { message: TMessage; reason: string } {
  if (!message.Body) {
    return {
      message,
      reason: "El cuerpo del mensaje está vacío.",
    };
  }

  try {
    const event: unknown = JSON.parse(message.Body);

    if (!isProcessS3EventInput(event)) {
      return {
        message,
        reason: "La estructura del evento S3 no es válida.",
      };
    }

    return {
      message,
      event: {
        ...event,
        eventTime: typeof event.eventTime === "string" ? new Date(event.eventTime) : event.eventTime,
      },
    };
  } catch {
    return {
      message,
      reason: "El mensaje contiene JSON inválido.",
    };
  }
}

/**
 * Inicializa las dependencias de almacenamiento y consume eventos S3 durables.
 *
 * Los mensajes solo se confirman después de completar correctamente
 * las operaciones de almacenamiento y la invalidación de caché.
 */
async function run(): Promise<void> {
  console.info("[worker-eventos-s3] Worker iniciado.");

  try {
    if (database) {
      await Promise.all([ensurePostgresSaveFileIndexSchema(database), ensurePostgresGameStatSchema(database)]);

      console.info("[worker-eventos-s3] Esquemas de PostgreSQL verificados.");
    }

    while (!stopping) {
      try {
        const response = await receiveS3Events(queue, activeQueueUrl);
        let messages = response.Messages ?? [];

        if (messages.length === 0) {
          continue;
        }

        if (messages.length < 10) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));

          const additional = await receiveS3Events(queue, activeQueueUrl, 10 - messages.length, 0);

          messages = [...messages, ...(additional.Messages ?? [])];
        }

        const parsedMessages = messages.map(parseS3EventMessage);

        const validMessages = parsedMessages.filter(
          (
            result
          ): result is {
            message: (typeof messages)[number];
            event: ProcessS3EventInput;
          } => "event" in result
        );

        const invalidMessages = parsedMessages.filter(
          (
            result
          ): result is {
            message: (typeof messages)[number];
            reason: string;
          } => "reason" in result
        );

        for (const invalid of invalidMessages) {
          console.error("[worker-eventos-s3] Se recibió un mensaje inválido.", {
            messageId: invalid.message.MessageId,
            reason: invalid.reason,
          });
        }

        if (validMessages.length === 0) {
          continue;
        }

        const events = validMessages.map(({ event }) => event);
        const validSqsMessages = validMessages.map(({ message }) => message);

        await useCase.executeBatch(events);

        const cacheResponse = await fetch(`${apiUrl}/internal/s3-events/processed`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": activeApiKey,
          },
          body: JSON.stringify({ events }),
        });

        if (!cacheResponse.ok) {
          throw new Error(`La API rechazó la invalidación de caché (${cacheResponse.status}).`);
        }

        await deleteS3Events(queue, activeQueueUrl, validSqsMessages);

        console.info(`[worker-eventos-s3] ${validMessages.length} eventos procesados y confirmados.`);
      } catch (error) {
        console.error(
          "[worker-eventos-s3] Falló el procesamiento del lote. SQS volverá a entregar los mensajes no confirmados.",
          error
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.info("[worker-eventos-s3] Worker detenido.");
  } finally {
    try {
      queue.destroy();
    } finally {
      try {
        dynamo?.destroy();
      } finally {
        await database?.close();
      }
    }
  }
}

/**
 * Comprueba que un objeto tenga la estructura esperada de un evento S3.
 */
function isProcessS3EventInput(value: unknown): value is ProcessS3EventInput & { eventTime?: Date | string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;

  if (event.detailType !== "Object Created" && event.detailType !== "Object Deleted") {
    return false;
  }

  if (typeof event.s3Key !== "string" || event.s3Key.length === 0) {
    return false;
  }

  if (event.eventTime === undefined) {
    return true;
  }

  if (event.eventTime instanceof Date) {
    return !Number.isNaN(event.eventTime.getTime());
  }

  return typeof event.eventTime === "string" && !Number.isNaN(Date.parse(event.eventTime));
}

run().catch((error: unknown) => {
  console.error("[worker-eventos-s3] Error fatal.", error);
  process.exitCode = 1;
});
