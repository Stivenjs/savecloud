import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { ProcessS3EventUseCase, type ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";

const GAME_STATS_TABLE = process.env.GAME_STATS_TABLE;
const SAVE_FILES_INDEX_TABLE = process.env.SAVE_FILES_INDEX_TABLE;

if (!GAME_STATS_TABLE) throw new Error("GAME_STATS_TABLE environment variable is missing");
if (!SAVE_FILES_INDEX_TABLE) throw new Error("SAVE_FILES_INDEX_TABLE environment variable is missing");

const dynamoClient = new DynamoDBClient({
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: 100 }),
    connectionTimeout: 500,
    socketTimeout: 5000,
  }),
});

const gameStatRepo = new DynamoDbGameStatRepository(dynamoClient, GAME_STATS_TABLE);
const saveFileIndexRepo = new DynamoDbSaveFileIndexRepository(dynamoClient, SAVE_FILES_INDEX_TABLE);
const processS3EventUseCase = new ProcessS3EventUseCase(saveFileIndexRepo, gameStatRepo);

export interface S3EventBridgeDetail {
  version?: string;
  bucket?: {
    name?: string;
  };
  object?: {
    key?: string;
    size?: number;
    etag?: string;
    "version-id"?: string;
    sequencer?: string;
  };
  "request-id"?: string;
  requester?: string;
  "source-ip-address"?: string;
  reason?: string;
}

export interface S3EventBridgePayload {
  source?: string;
  "detail-type"?: string;
  detailType?: string;
  time?: string;
  region?: string;
  resources?: string[];
  detail?: S3EventBridgeDetail;
}

export interface SQSRecordPayload {
  messageId?: string;
  receiptHandle?: string;
  body?: string;
  attributes?: Record<string, string>;
  messageAttributes?: Record<string, unknown>;
  md5OfBody?: string;
  eventSource?: string;
  eventSourceARN?: string;
  awsRegion?: string;
}

export interface SQSEventPayload {
  Records?: SQSRecordPayload[];
}

export type SyncGameStatsIncomingEvent = SQSEventPayload & S3EventBridgePayload;

export interface SyncGameStatsBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

function extractEventInput(eventBody: unknown): ProcessS3EventInput | null {
  if (!eventBody || typeof eventBody !== "object") return null;

  const payload = eventBody as S3EventBridgePayload;
  const rawDetailType: string | undefined = payload.detailType ?? payload["detail-type"];
  const eventTimeRaw: string | undefined = payload.time;
  const eventTime = eventTimeRaw ? new Date(eventTimeRaw) : undefined;

  const detailObject = payload.detail?.object;
  const rawKey: string | undefined = detailObject?.key;

  if (!rawKey || !rawDetailType) return null;

  let s3Key = rawKey;
  try {
    s3Key = decodeURIComponent(rawKey.replace(/\+/g, " "));
  } catch {}

  const detailType: "Object Created" | "Object Deleted" =
    rawDetailType === "Object Deleted" ? "Object Deleted" : "Object Created";
  const size = typeof detailObject?.size === "number" ? detailObject.size : undefined;

  return {
    detailType,
    s3Key,
    size,
    eventTime,
  };
}

export const handler = async (event: SyncGameStatsIncomingEvent): Promise<SyncGameStatsBatchResponse> => {
  if (!event) return { batchItemFailures: [] };

  const inputs: ProcessS3EventInput[] = [];
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const validRecords: SQSRecordPayload[] = [];

  if (Array.isArray(event.Records) && event.Records.length > 0) {
    for (const record of event.Records) {
      if (!record?.messageId || !record.body) {
        if (record?.messageId) batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const parsedBody: unknown = typeof record.body === "string" ? JSON.parse(record.body) : record.body;
        const item = extractEventInput(parsedBody);
        if (!item) {
          batchItemFailures.push({ itemIdentifier: record.messageId });
          continue;
        }
        inputs.push(item);
        validRecords.push(record);
      } catch (error) {
        console.warn("[syncGameStats] No se pudo interpretar un mensaje SQS", {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  } else {
    const single = extractEventInput(event);
    if (single) inputs.push(single);
  }

  if (inputs.length > 0) {
    try {
      await processS3EventUseCase.executeBatch(inputs);
    } catch (error) {
      console.error("[syncGameStats] Falló el procesamiento del lote SQS", {
        recordCount: validRecords.length,
        error: error instanceof Error ? error.message : String(error),
      });
      batchItemFailures.push(
        ...validRecords.flatMap((record) => (record.messageId ? [{ itemIdentifier: record.messageId }] : []))
      );
    }
  }

  return { batchItemFailures };
};
