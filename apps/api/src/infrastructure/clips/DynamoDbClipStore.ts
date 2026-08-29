import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { resolvePublicUrl } from "@infrastructure/factories/storageFactory";
import type { ClipDto, ClipMetadata, GetClipResult } from "./ClipStore";

const CLIP_META_PREFIX = "clips-meta/";
const CLIP_VIDEO_PREFIX = "clips/";
const PRESIGN_EXPIRES_IN_SECONDS = 900;

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length > 1) {
    return parts.pop()!.toLowerCase();
  }
  return "mp4";
}

function resolveContentType(ext: string, override?: string): string {
  if (override && override.startsWith("video/")) {
    return override;
  }
  switch (ext) {
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "mp4":
    default:
      return "video/mp4";
  }
}

export class DynamoDbClipStore {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucketName: string;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(s3: S3Client, bucketName: string, dynamoClient: DynamoDBClient, tableName: string, presignS3?: S3Client) {
    this.s3 = s3;
    this.presignS3 = presignS3 ?? s3;
    this.bucketName = bucketName;
    this.tableName = tableName;
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  buildCdnUrl(key: string): string {
    const downloadBase = process.env.DOWNLOAD_BASE_URL?.trim();
    if (downloadBase) {
      return `${downloadBase.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
    }

    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim();
    if (publicEndpoint) {
      return `${publicEndpoint.replace(/\/$/, "")}/${this.bucketName}/${key.replace(/^\//, "")}`;
    }

    return `https://${this.bucketName}.s3.amazonaws.com/${key.replace(/^\//, "")}`;
  }

  async createClipUploadUrl(
    userId: string,
    gameId: string,
    filename: string,
    contentTypeOverride?: string,
    options?: {
      posterUrl?: string;
      steamAppId?: string;
      gameTitle?: string;
      thumbnailBase64?: string;
    }
  ): Promise<{ clipId: string; uploadUrl: string; cdnUrl: string; videoKey: string }> {
    if (!userId?.trim()) throw new Error("userId is required");
    if (!gameId?.trim()) throw new Error("gameId is required");
    if (!filename?.trim()) throw new Error("filename is required");

    const clipId = randomBytes(12).toString("hex");
    const ext = getFileExtension(filename);
    const contentType = resolveContentType(ext, contentTypeOverride);
    const videoKey = `${CLIP_VIDEO_PREFIX}${userId.trim()}/${gameId.trim()}/${clipId}.${ext}`;

    let resolvedPosterUrl = options?.posterUrl?.trim() || undefined;

    if (options?.thumbnailBase64?.trim()) {
      try {
        const base64Data = options.thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
        const thumbBuffer = Buffer.from(base64Data, "base64");
        if (thumbBuffer.length > 0 && thumbBuffer.length < 5 * 1024 * 1024) {
          const thumbKey = `${CLIP_VIDEO_PREFIX}${userId.trim()}/${gameId.trim()}/${clipId}-thumb.jpg`;
          await this.s3.send(
            new PutObjectCommand({
              Bucket: this.bucketName,
              Key: thumbKey,
              Body: thumbBuffer,
              ContentType: "image/jpeg",
              CacheControl: "public, max-age=31536000, immutable",
            })
          );
          resolvedPosterUrl = this.buildCdnUrl(thumbKey);
        }
      } catch {}
    }

    const metadata: ClipMetadata = {
      clipId,
      userId: userId.trim(),
      gameId: gameId.trim(),
      filename: filename.trim(),
      videoKey,
      contentType,
      createdAt: new Date().toISOString(),
      ...(resolvedPosterUrl ? { posterUrl: resolvedPosterUrl } : {}),
      ...(options?.steamAppId?.trim() ? { steamAppId: options.steamAppId.trim() } : {}),
      ...(options?.gameTitle?.trim() ? { gameTitle: options.gameTitle.trim() } : {}),
    };

    // Guardar metadata del clip en DynamoDB (sub-5ms)
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: metadata,
      })
    );

    // Generar URL PUT prefirmada para el archivo de vídeo
    const putCommand = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: videoKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.presignS3, putCommand, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });

    const cdnUrl = this.buildCdnUrl(videoKey);

    return {
      clipId,
      uploadUrl: resolvePublicUrl(uploadUrl),
      cdnUrl,
      videoKey,
    };
  }

  async getClip(clipId: string): Promise<GetClipResult> {
    if (!clipId?.trim()) return { status: "not_found" };

    try {
      // 1. Consulta indexada instantánea en DynamoDB vía ClipIdIndex
      const queryRes = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "ClipIdIndex",
          KeyConditionExpression: "clipId = :clipId",
          ExpressionAttributeValues: {
            ":clipId": clipId.trim(),
          },
          Limit: 1,
        })
      );

      const item = queryRes.Items?.[0] as ClipMetadata | undefined;
      if (item) {
        return {
          status: "ok",
          clip: item,
          cdnUrl: this.buildCdnUrl(item.videoKey),
        };
      }

      // 2. Fallback retrocompatible a S3 para clips preexistentes (lazy migration)
      const s3Clip = await this.getClipFromS3Fallback(clipId.trim());
      if (s3Clip) {
        // Migrar a DynamoDB en segundo plano para futuras consultas
        this.docClient.send(new PutCommand({ TableName: this.tableName, Item: s3Clip })).catch(() => {});

        return {
          status: "ok",
          clip: s3Clip,
          cdnUrl: this.buildCdnUrl(s3Clip.videoKey),
        };
      }

      return { status: "not_found" };
    } catch (err) {
      console.error("[DynamoDbClipStore] Error al obtener clip", { clipId, err });
      return { status: "error", cause: err };
    }
  }

  async listClips(userId: string, gameId?: string, baseUrl: string = ""): Promise<ClipDto[]> {
    if (!userId?.trim()) return [];

    const normalizedUserId = userId.trim();
    const normalizedGameId = gameId?.trim();

    try {
      const expressionValues: Record<string, unknown> = {
        ":userId": normalizedUserId,
      };
      let filterExpression: string | undefined = undefined;

      if (normalizedGameId) {
        filterExpression = "gameId = :gameId";
        expressionValues[":gameId"] = normalizedGameId;
      }

      const res = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "userId = :userId",
          ScanIndexForward: false, // Orden descendente por createdAt (más recientes primero)
          ExpressionAttributeValues: expressionValues,
          FilterExpression: filterExpression,
        })
      );

      let items = (res.Items ?? []) as ClipMetadata[];

      // Fallback transparente a S3 si DynamoDB aún no tiene los clips migrados
      if (items.length === 0) {
        const s3Clips = await this.listClipsFromS3Fallback(normalizedUserId, normalizedGameId);
        if (s3Clips.length > 0) {
          // Guardar en DynamoDB en segundo plano
          for (const clip of s3Clips) {
            this.docClient.send(new PutCommand({ TableName: this.tableName, Item: clip })).catch(() => {});
          }
          items = s3Clips;
        }
      }

      return items.map((clip) => ({
        ...clip,
        cdnUrl: this.buildCdnUrl(clip.videoKey),
        watchUrl: baseUrl ? `${baseUrl}/v/${clip.clipId}` : `/v/${clip.clipId}`,
      }));
    } catch (err) {
      console.error("[DynamoDbClipStore] Failed to list clips", { userId, gameId, err });
      return [];
    }
  }

  async deleteUserClip(userId: string, clipId: string): Promise<boolean> {
    if (!userId?.trim() || !clipId?.trim()) return false;
    const clipResult = await this.getClip(clipId);
    if (clipResult.status !== "ok") return false;

    if (clipResult.clip.userId.toLowerCase() !== userId.trim().toLowerCase()) {
      return false;
    }

    try {
      await Promise.all([
        this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              userId: clipResult.clip.userId,
              createdAt: clipResult.clip.createdAt,
            },
          })
        ),
        this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: clipResult.clip.videoKey,
          })
        ),
        this.s3
          .send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: `${CLIP_META_PREFIX}${clipId.trim()}.json`,
            })
          )
          .catch(() => {}),
      ]);
      return true;
    } catch (err) {
      console.error("[DynamoDbClipStore] Failed to delete clip", { clipId, err });
      return false;
    }
  }

  async deleteClip(clipId: string): Promise<boolean> {
    if (!clipId?.trim()) return false;
    const clipResult = await this.getClip(clipId);
    if (clipResult.status !== "ok") return false;

    try {
      await Promise.all([
        this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              userId: clipResult.clip.userId,
              createdAt: clipResult.clip.createdAt,
            },
          })
        ),
        this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: clipResult.clip.videoKey,
          })
        ),
        this.s3
          .send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: `${CLIP_META_PREFIX}${clipId.trim()}.json`,
            })
          )
          .catch(() => {}),
      ]);
      return true;
    } catch (err) {
      console.error("[DynamoDbClipStore] Failed to delete clip", { clipId, err });
      return false;
    }
  }

  private async getClipFromS3Fallback(clipId: string): Promise<ClipMetadata | null> {
    try {
      const metaKey = `${CLIP_META_PREFIX}${clipId}.json`;
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: metaKey,
        })
      );
      const body = await response.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body) as ClipMetadata;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      return null;
    }
  }

  private async listClipsFromS3Fallback(userId: string, gameId?: string): Promise<ClipMetadata[]> {
    try {
      const listResp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: CLIP_META_PREFIX,
          MaxKeys: 300,
        })
      );

      const contents = listResp.Contents ?? [];
      const metaKeys = contents.map((item) => item.Key).filter((k): k is string => Boolean(k && k.endsWith(".json")));

      const clipsWithMeta = await Promise.all(
        metaKeys.map(async (key) => {
          try {
            const obj = await this.s3.send(
              new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
              })
            );
            const raw = await obj.Body?.transformToString();
            if (!raw) return null;
            return JSON.parse(raw) as ClipMetadata;
          } catch {
            return null;
          }
        })
      );

      const normalizedUserId = userId.trim().toLowerCase();
      const normalizedGameId = gameId?.trim().toLowerCase();

      return clipsWithMeta
        .filter((c): c is ClipMetadata => {
          if (!c) return false;
          if (c.userId.toLowerCase() !== normalizedUserId) return false;
          if (normalizedGameId && c.gameId.toLowerCase() !== normalizedGameId) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      console.error("[DynamoDbClipStore] Error en fallback de clips de S3", { userId, gameId, err });
      return [];
    }
  }
}
