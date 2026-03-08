import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "@interfaces/http/app";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

const bucketName = process.env.BUCKET_NAME ?? "";
const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-2",
  useAccelerateEndpoint: true,
});
const saveRepository = new S3SaveRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);

let cachedProxy: ReturnType<typeof awsLambdaFastify> | null = null;

async function getProxy() {
  if (!cachedProxy) {
    const app = await buildApp({ saveRepository, shareTokenStore });
    cachedProxy = awsLambdaFastify(app, {
      binaryMimeTypes: ["application/octet-stream"],
    });
  }
  return cachedProxy;
}

/**
 * Handler de Lambda: delega en Fastify vía @fastify/aws-lambda.
 * La app se reutiliza entre invocaciones (cache) para reducir cold starts.
 */
export async function handler(
  event: unknown,
  context: unknown
): Promise<unknown> {
  const proxy = await getProxy();
  const invoke = proxy as (
    event: unknown,
    context: unknown
  ) => Promise<unknown>;
  return invoke(event, context);
}
