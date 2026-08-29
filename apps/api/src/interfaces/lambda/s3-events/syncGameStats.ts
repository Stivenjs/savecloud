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

function extractEventInput(eventBody: unknown): ProcessS3EventInput | null {
  if (!eventBody || typeof eventBody !== "object") return null;

  const payload = eventBody as S3EventBridgePayload;
  const rawDetailType: string | undefined = payload.detailType ?? payload["detail-type"];
  const eventTimeRaw: string | undefined = payload.time;
  const eventTime = eventTimeRaw ? new Date(eventTimeRaw) : undefined;

  const detailObject = payload.detail?.object;
  const s3Key: string | undefined = detailObject?.key;

  if (!s3Key || !rawDetailType) return null;

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

export const handler = async (event: SyncGameStatsIncomingEvent): Promise<void> => {
  if (!event) return;

  const inputs: ProcessS3EventInput[] = [];

  if (Array.isArray(event.Records) && event.Records.length > 0) {
    for (const record of event.Records) {
      if (!record?.body) continue;
      try {
        const parsedBody: unknown = typeof record.body === "string" ? JSON.parse(record.body) : record.body;
        const item = extractEventInput(parsedBody);
        if (item) inputs.push(item);
      } catch (err) {
        console.warn("[syncGameStats] Failed to parse SQS record body:", err);
      }
    }
  } else {
    const single = extractEventInput(event);
    if (single) inputs.push(single);
  }

  if (inputs.length > 0) {
    await processS3EventUseCase.executeBatch(inputs);
  }
};
