import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";

const MAX_BATCH_SIZE = 10;

/** Cliente SQS para desacoplar la recepción de notificaciones del trabajo en DynamoDB. */
export function createS3EventQueueClient(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT?.trim();
  return new SQSClient({
    region: process.env.AWS_REGION?.trim() || "us-east-1",
    endpoint: endpoint || undefined,
    credentials: endpoint
      ? {
          accessKeyId: process.env.SQS_ACCESS_KEY_ID?.trim() || "local",
          secretAccessKey: process.env.SQS_SECRET_ACCESS_KEY?.trim() || "local",
        }
      : undefined,
  });
}

/** Crea de forma idempotente la cola configurada para los eventos S3. */
export async function ensureS3EventQueue(client: SQSClient, queueName: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await client.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: { VisibilityTimeout: "300", ReceiveMessageWaitTimeSeconds: "20" },
        })
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`No se pudo crear la cola SQS '${queueName}' después de 30 intentos.`, { cause: lastError });
}

/** Encola eventos S3 en lotes SQS y solo resuelve cuando todos fueron aceptados. */
export async function enqueueS3Events(
  client: SQSClient,
  queueUrl: string,
  events: ProcessS3EventInput[]
): Promise<void> {
  for (let offset = 0; offset < events.length; offset += MAX_BATCH_SIZE) {
    const batch = events.slice(offset, offset + MAX_BATCH_SIZE);
    const result = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((event, index) => ({
          Id: String(index),
          MessageBody: JSON.stringify(event),
        })),
      })
    );

    if (result.Failed?.length) {
      throw new Error(`No se pudieron encolar ${result.Failed.length} eventos S3.`);
    }
  }
}

/** Obtiene un lote de eventos pendientes con espera larga para evitar sondeo constante. */
export async function receiveS3Events(
  client: SQSClient,
  queueUrl: string,
  maxMessages = MAX_BATCH_SIZE,
  waitTimeSeconds = 20
) {
  return client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.min(MAX_BATCH_SIZE, maxMessages),
      WaitTimeSeconds: waitTimeSeconds,
      VisibilityTimeout: 300,
    })
  );
}

/** Elimina únicamente los mensajes cuyo lote ya terminó de procesarse. */
export async function deleteS3Events(
  client: SQSClient,
  queueUrl: string,
  messages: Array<{ MessageId?: string; ReceiptHandle?: string }>
): Promise<void> {
  const entries = messages.flatMap((message, index) =>
    message.MessageId && message.ReceiptHandle ? [{ Id: String(index), ReceiptHandle: message.ReceiptHandle }] : []
  );
  if (entries.length === 0) return;

  const result = await client.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }));
  if (result.Failed?.length) throw new Error(`No se pudieron confirmar ${result.Failed.length} eventos S3.`);
}
