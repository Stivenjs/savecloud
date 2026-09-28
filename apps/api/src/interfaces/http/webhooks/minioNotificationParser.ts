import type { ProcessS3EventInput } from "@application/use-cases/ProcessS3EventUseCase";

export interface MinioObjectRecord {
  eventName?: string;
  eventTime?: string;
  Key?: string;
  s3?: {
    object?: {
      key?: string;
      size?: number;
    };
  };
}

export interface MinioNotificationPayload {
  EventName?: string;
  Key?: string;
  Records?: MinioObjectRecord[];
}

export function parseMinioNotification(body: unknown): ProcessS3EventInput[] {
  if (!body || typeof body !== "object") return [];

  const payload = body as MinioNotificationPayload;
  const results: ProcessS3EventInput[] = [];
  const records: MinioObjectRecord[] = Array.isArray(payload.Records)
    ? payload.Records
    : [payload as MinioObjectRecord];
  const bucketName = process.env.BUCKET_NAME || "savecloud-saves";

  for (const record of records) {
    let rawKey = record?.s3?.object?.key || record?.Key || payload.Key || "";
    if (!rawKey) continue;

    let decodedKey = decodeURIComponent(rawKey.replace(/\+/g, " "));
    if (decodedKey.startsWith(`${bucketName}/`)) decodedKey = decodedKey.slice(bucketName.length + 1);

    const eventName = record?.eventName || payload.EventName || "";
    const detailType: "Object Created" | "Object Deleted" =
      eventName.toLowerCase().includes("delete") || eventName.toLowerCase().includes("removed")
        ? "Object Deleted"
        : "Object Created";
    const size = typeof record?.s3?.object?.size === "number" ? record.s3.object.size : undefined;
    const eventTime = record?.eventTime ? new Date(record.eventTime) : undefined;
    results.push({ detailType, s3Key: decodedKey, size, eventTime });
  }

  return results;
}
