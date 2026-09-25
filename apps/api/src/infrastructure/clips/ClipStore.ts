import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { resolvePublicUrl } from "@infrastructure/factories/storageFactory";

const CLIP_META_PREFIX = "clips-meta/";
const CLIP_VIDEO_PREFIX = "clips/";
const PRESIGN_EXPIRES_IN_SECONDS = 900;

export interface ClipMetadata {
  clipId: string;
  userId: string;
  gameId: string;
  filename: string;
  videoKey: string;
  contentType: string;
  createdAt: string;
  posterUrl?: string;
  steamAppId?: string;
  gameTitle?: string;
}

export interface ClipDto extends ClipMetadata {
  cdnUrl: string;
  watchUrl: string;
}

export type GetClipResult =
  | { status: "ok"; clip: ClipMetadata; cdnUrl: string }
  | { status: "not_found" }
  | { status: "error"; cause?: unknown };

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

export class ClipStore {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucketName: string;

  constructor(s3: S3Client, bucketName: string, presignS3?: S3Client) {
    this.s3 = s3;
    this.presignS3 = presignS3 ?? s3;
    this.bucketName = bucketName;
  }

  /**
   * Resuelve la URL pública del CDN para un objeto de vídeo.
   */
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

  /**
   * Genera un identificador de clip y una URL presignada para que el cliente
   * suba directamente el vídeo a S3.
   */
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

    // Guardar metadata del clip en S3
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: `${CLIP_META_PREFIX}${clipId}.json`,
        Body: JSON.stringify(metadata),
        ContentType: "application/json",
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

  /**
   * Obtiene la metadata y la URL CDN de un clip a partir de su ID.
   */
  async getClip(clipId: string): Promise<GetClipResult> {
    if (!clipId?.trim()) return { status: "not_found" };

    const metaKey = `${CLIP_META_PREFIX}${clipId.trim()}.json`;

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: metaKey,
        })
      );

      const body = await response.Body?.transformToString();
      if (!body) return { status: "not_found" };

      const clip = JSON.parse(body) as ClipMetadata;
      const cdnUrl = this.buildCdnUrl(clip.videoKey);

      return {
        status: "ok",
        clip,
        cdnUrl,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) {
        return { status: "not_found" };
      }
      return { status: "error", cause: err };
    }
  }

  /**
   * Lista los clips pertenecientes a un usuario (y opcionalmente filtrados por juego).
   */
  async listClips(userId: string, gameId?: string, baseUrl: string = ""): Promise<ClipDto[]> {
    if (!userId?.trim()) return [];

    try {
      const listResp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: CLIP_META_PREFIX,
          MaxKeys: 200,
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
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((clip) => ({
          ...clip,
          cdnUrl: this.buildCdnUrl(clip.videoKey),
          watchUrl: baseUrl ? `${baseUrl}/v/${clip.clipId}` : `/v/${clip.clipId}`,
        }));
    } catch (err) {
      console.error("[ClipStore] Failed to list clips", { userId, gameId, err });
      return [];
    }
  }

  /**
   * Elimina un clip validando que pertenezca al usuario especificado.
   */
  async deleteUserClip(userId: string, clipId: string): Promise<boolean> {
    if (!userId?.trim() || !clipId?.trim()) return false;
    const clipResult = await this.getClip(clipId);
    if (clipResult.status !== "ok") return false;

    if (clipResult.clip.userId.toLowerCase() !== userId.trim().toLowerCase()) {
      return false;
    }

    try {
      await Promise.all([
        this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: clipResult.clip.videoKey })),
        this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: `${CLIP_META_PREFIX}${clipId.trim()}.json` })
        ),
      ]);
      return true;
    } catch (err) {
      console.error("[ClipStore] Failed to delete clip", { clipId, err });
      return false;
    }
  }

  /**
   * Elimina el clip y sus metadatos de S3 (sin comprobación de usuario).
   */
  async deleteClip(clipId: string): Promise<boolean> {
    if (!clipId?.trim()) return false;
    const clipResult = await this.getClip(clipId);
    if (clipResult.status !== "ok") return false;

    try {
      await Promise.all([
        this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: clipResult.clip.videoKey })),
        this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: `${CLIP_META_PREFIX}${clipId.trim()}.json` })
        ),
      ]);
      return true;
    } catch (err) {
      console.error("[ClipStore] Failed to delete clip", { clipId, err });
      return false;
    }
  }
}
