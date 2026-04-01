import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { buildApp } from "@interfaces/http/app";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { S3SaveRepository } from "@infrastructure/persistence/S3SaveRepository";
import { S3SteamSeedRepository } from "@infrastructure/persistence/S3SteamSeedRepository";
import { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

const bucketName = process.env.BUCKET_NAME ?? "";

const httpsAgent = new Agent({
  keepAlive: true,
  maxSockets: 50,
});

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-2",
  useAccelerateEndpoint: process.env.USE_ACCELERATE_ENDPOINT === "true",
  requestHandler: new NodeHttpHandler({
    httpsAgent,
    connectionTimeout: 300,
    socketTimeout: 3000,
  }),
});

const saveRepository = new S3SaveRepository(s3, bucketName);
const steamSeedRepository = new S3SteamSeedRepository(s3, bucketName);
const shareTokenStore = new ShareTokenS3(s3, bucketName);
const notificationStore = new S3NotificationStore(s3, bucketName);
const cloudInviteRepository = new S3CloudInviteRepository(s3, bucketName);

let cachedProxy: ((event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>) | null = null;

async function getProxy() {
  if (!cachedProxy) {
    const app = await buildApp({
      saveRepository,
      steamSeedRepository,
      shareTokenStore,
      notificationStore,
      cloudInviteRepository,
    });

    cachedProxy = awsLambdaFastify(app, {
      binaryMimeTypes: ["application/octet-stream"],
      callbackWaitsForEmptyEventLoop: false,
    });

    await app.ready();
  }

  return cachedProxy;
}

/**
 * Handler de Lambda: delega en Fastify vía @fastify/aws-lambda.
 * La app se reutiliza entre invocaciones (cache) para reducir cold starts.
 */
export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  context.callbackWaitsForEmptyEventLoop = false;
  const proxy = await getProxy();
  return proxy(event, context);
}
