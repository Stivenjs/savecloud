import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Client, getBucketName } from "@infrastructure/factories/storageFactory";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2000;
const CLIP_COVER_ASSET_KEY = "clips/assets/savecloud-clip-cover.png";

async function main(): Promise<void> {
  const s3 = createS3Client();
  const bucketName = getBucketName();
  await ensureBucketExists(s3, bucketName);

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadSharedClipObjects",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: `arn:aws:s3:::${bucketName}/clips/*`,
          },
        ],
      }),
    })
  );

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "HEAD", "PUT"],
            AllowedOrigins: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: [
          lifecycleRule("ExpireShareTokens7Days", "share-tokens/", 7),
          lifecycleRule("ExpirePendingCloudInvites30Days", "cloud-invites/", 30),
          lifecycleRule("ExpireNotifications30Days", "notifications/", 30),
          lifecycleRule("ExpireOldGameInventory90Days", "game-inventory/", 90),
        ],
      },
    })
  );

  await s3.send(
    new PutBucketNotificationConfigurationCommand({
      Bucket: bucketName,
      NotificationConfiguration: {
        QueueConfigurations: [
          {
            Id: "savecloud-object-events",
            QueueArn: "arn:minio:sqs::primary:webhook",
            Events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"],
          },
        ],
      },
    })
  );

  await ensureAppClipCoverAsset(s3, bucketName);
  console.info(
    `[storage-bootstrap] Bucket '${bucketName}' listo con CORS, lifecycle, webhook, lectura pública y cover asset de clips.`
  );
}

function findProjectAppIcon(): Buffer | null {
  const candidatePaths = [
    resolve(__dirname, "assets/savecloud-clip-cover.png"),
    resolve(process.cwd(), "dist/assets/savecloud-clip-cover.png"),
    resolve(process.cwd(), "apps/desktop/src-tauri/icons/Square310x310Logo.png"),
    resolve(__dirname, "../../../../../apps/desktop/src-tauri/icons/Square310x310Logo.png"),
    resolve(__dirname, "../../../../apps/desktop/src-tauri/icons/Square310x310Logo.png"),
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return readFileSync(candidate);
    }
  }

  return null;
}

async function ensureAppClipCoverAsset(s3: ReturnType<typeof createS3Client>, bucketName: string): Promise<void> {
  try {
    const iconBuffer = findProjectAppIcon();
    if (!iconBuffer) {
      console.warn(
        `[storage-bootstrap] No se encontró el icono del proyecto para copiar a '${CLIP_COVER_ASSET_KEY}'. Se omite la subida.`
      );
      return;
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: CLIP_COVER_ASSET_KEY,
        Body: iconBuffer,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    console.info(`[storage-bootstrap] Icono del proyecto copiado al bucket: '${bucketName}/${CLIP_COVER_ASSET_KEY}'.`);
  } catch (error) {
    console.warn(`[storage-bootstrap] Advertencia al copiar icono '${CLIP_COVER_ASSET_KEY}':`, error);
  }
}

async function ensureBucketExists(s3: ReturnType<typeof createS3Client>, bucketName: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      return;
    } catch (headError: unknown) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
        return;
      } catch (createError: unknown) {
        if ((createError as { name?: string }).name === "BucketAlreadyOwnedByYou") return;
        lastError = createError ?? headError;
        console.info(`[storage-bootstrap] Esperando al servicio S3 (${attempt}/${MAX_ATTEMPTS}).`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(`[storage-bootstrap] No se pudo crear o acceder al bucket '${bucketName}'.`, { cause: lastError });
}

function lifecycleRule(id: string, prefix: string, days: number) {
  return {
    ID: id,
    Filter: { Prefix: prefix },
    Status: "Enabled" as const,
    Expiration: { Days: days },
  };
}

main().catch((error: unknown) => {
  console.error("[storage-bootstrap] Error al inicializar el almacenamiento local:", error);
  process.exitCode = 1;
});
