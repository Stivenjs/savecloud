import { S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "@interfaces/http/app";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

const bucketName = process.env.BUCKET_NAME ?? "sync-games-saves-dev";
const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-2",
  useAccelerateEndpoint: true,
});
const saveRepository = new S3SaveRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);

async function main() {
  const app = await buildApp({ saveRepository, shareTokenStore });
  const port = Number(process.env.PORT) || 3000;
  app.listen({ port, host: "0.0.0.0" }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

main();
