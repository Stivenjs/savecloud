import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";

const PREFIX = "share-tokens/";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const TOKEN_BYTES = 24;

export interface ShareTokenPayload {
  userId: string;
  gameId: string;
  expiresAt: string; // ISO
}

export class ShareTokenS3 {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  async createToken(
    userId: string,
    gameId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<{ token: string }> {
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const key = `${PREFIX}${token}`;
    const body = JSON.stringify({
      userId,
      gameId,
      expiresAt,
    } as ShareTokenPayload);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: "application/json",
      })
    );
    return { token };
  }

  async getToken(token: string): Promise<ShareTokenPayload | null> {
    if (!token?.trim()) return null;
    const key = `${PREFIX}${token.trim()}`;
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
      const body = await res.Body?.transformToString();
      if (!body) return null;
      const payload = JSON.parse(body) as ShareTokenPayload;
      if (new Date(payload.expiresAt) <= new Date()) return null;
      return payload;
    } catch {
      return null;
    }
  }
}
