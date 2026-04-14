import { S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "@interfaces/http/app";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

const bucketName = process.env.BUCKET_NAME ?? "SaveCloud-saves-dev";
const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-2",
  useAccelerateEndpoint: process.env.USE_ACCELERATE_ENDPOINT === "true",
});
const saveRepository = new S3SaveRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);
const notificationStore = new S3NotificationStore(s3, bucketName);
const cloudInviteRepository = new S3CloudInviteRepository(s3, bucketName);

async function main() {
  const app = await buildApp({ saveRepository, shareTokenStore, notificationStore, cloudInviteRepository });
  const port = Number(process.env.PORT) || 3000;
  app.listen({ port, host: "0.0.0.0" }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

main();
