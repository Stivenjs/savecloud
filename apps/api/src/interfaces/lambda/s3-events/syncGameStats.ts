import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbGameStatRepository } from "@infrastructure/persistence/DynamoDbGameStatRepository";
import { DynamoDbSaveFileIndexRepository } from "@infrastructure/persistence/DynamoDbSaveFileIndexRepository";
import { ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";

const GAME_STATS_TABLE = process.env.GAME_STATS_TABLE;
const SAVE_FILES_INDEX_TABLE = process.env.SAVE_FILES_INDEX_TABLE;

if (!GAME_STATS_TABLE) throw new Error("GAME_STATS_TABLE environment variable is missing");
if (!SAVE_FILES_INDEX_TABLE) throw new Error("SAVE_FILES_INDEX_TABLE environment variable is missing");

const dynamoClient = new DynamoDBClient();

const gameStatRepo = new DynamoDbGameStatRepository(dynamoClient, GAME_STATS_TABLE);
const saveFileIndexRepo = new DynamoDbSaveFileIndexRepository(dynamoClient, SAVE_FILES_INDEX_TABLE);
const processS3EventUseCase = new ProcessS3EventUseCase(saveFileIndexRepo, gameStatRepo);

export const handler = async (event: any) => {
  const rawDetailType: string | undefined = event.detailType ?? event["detail-type"];
  const eventTimeRaw: string | undefined = event.time;
  const eventTime = eventTimeRaw ? new Date(eventTimeRaw) : undefined;

  const detailObject = event.detail?.object;
  const s3Key: string | undefined = detailObject?.key;

  if (!s3Key || !rawDetailType) {
    return;
  }

  const detailType: "Object Created" | "Object Deleted" =
    rawDetailType === "Object Deleted" ? "Object Deleted" : "Object Created";

  const size = typeof detailObject?.size === "number" ? detailObject.size : undefined;

  await processS3EventUseCase.execute({
    detailType,
    s3Key,
    size,
    eventTime,
  });
};
