import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";
import type { GetTokenResult, ShareTokenPayload } from "./ShareTokenS3";

const S3_PREFIX = "share-tokens/";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días
const TOKEN_BYTES = 24;

export class DynamoDbShareTokenStore {
  private readonly dynamoClient: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly s3?: S3Client;
  private readonly bucketName?: string;

  constructor(dynamoClient: DynamoDBClient, tableName: string, s3?: S3Client, bucketName?: string) {
    this.dynamoClient = dynamoClient;
    this.tableName = tableName;
    this.s3 = s3;
    this.bucketName = bucketName;
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Genera un token criptográfico seguro y lo persiste en DynamoDB con TTL nativo.
   */
  async createToken(
    userId: string,
    gameId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<{ token: string; expiresAt: string }> {
    if (!userId?.trim()) throw new Error("userId must not be empty");
    if (!gameId?.trim()) throw new Error("gameId must not be empty");
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(`ttlSeconds must be a positive finite number, got: ${ttlSeconds}`);
    }

    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttlSeconds;

    const payload: ShareTokenPayload & { token: string; expiresAtEpoch: number } = {
      token,
      userId: userId.trim(),
      gameId: gameId.trim(),
      expiresAt,
      expiresAtEpoch,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: payload,
      })
    );

    return { token, expiresAt };
  }

  /**
   * Obtiene y valida un token desde DynamoDB (sub-2ms), con fallback transparente a S3 para tokens antiguos.
   */
  async getToken(token: string): Promise<GetTokenResult> {
    if (!token?.trim()) return { status: "not_found" };

    const cleanToken = token.trim();

    try {
      // 1. Consulta directa por clave primaria en DynamoDB
      const res = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { token: cleanToken },
        })
      );

      const item = res.Item as (ShareTokenPayload & { expiresAtEpoch?: number }) | undefined;

      if (item && item.userId && item.gameId && item.expiresAt) {
        if (new Date(item.expiresAt) <= new Date()) {
          this.deleteToken(cleanToken).catch(() => {});
          return { status: "expired" };
        }

        return {
          status: "ok",
          payload: {
            userId: item.userId,
            gameId: item.gameId,
            expiresAt: item.expiresAt,
          },
        };
      }

      // 2. Fallback a S3 para tokens creados previamente a la migración
      if (this.s3 && this.bucketName) {
        const s3Token = await this.getTokenFromS3Fallback(cleanToken);
        if (s3Token) {
          if (new Date(s3Token.expiresAt) <= new Date()) {
            return { status: "expired" };
          }
          return { status: "ok", payload: s3Token };
        }
      }

      return { status: "not_found" };
    } catch (err) {
      console.error("[DynamoDbShareTokenStore] Error al obtener token", { token: cleanToken, err });
      return { status: "error", cause: err };
    }
  }

  /**
   * Revoca y elimina un token de forma inmediata en DynamoDB y S3.
   */
  async deleteToken(token: string): Promise<boolean> {
    if (!token?.trim()) return false;
    const cleanToken = token.trim();

    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { token: cleanToken },
        })
      );

      if (this.s3 && this.bucketName) {
        this.s3
          .send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: `${S3_PREFIX}${cleanToken}`,
            })
          )
          .catch(() => {});
      }

      return true;
    } catch (err) {
      console.error("[DynamoDbShareTokenStore] Fallo al eliminar token", { token: cleanToken, err });
      return false;
    }
  }

  private async getTokenFromS3Fallback(token: string): Promise<ShareTokenPayload | null> {
    if (!this.s3 || !this.bucketName) return null;
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: `${S3_PREFIX}${token}`,
        })
      );
      const raw = await res.Body?.transformToString();
      if (!raw?.trim()) return null;
      const parsed = JSON.parse(raw) as ShareTokenPayload;
      if (parsed && typeof parsed.userId === "string" && typeof parsed.gameId === "string") {
        return parsed;
      }
      return null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      return null;
    }
  }
}
