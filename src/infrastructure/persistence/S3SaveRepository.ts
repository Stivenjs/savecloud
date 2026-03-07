import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { GameSave } from "@domain/entities/GameSave";
import type {
  DownloadUrlItem,
  DownloadUrlResult,
  SaveRepository,
  UploadUrlItem,
  UploadUrlResult,
} from "@domain/ports/SaveRepository";

const PRESIGN_EXPIRES_IN_SECONDS = 3600;

/**
 * Implementación del puerto SaveRepository usando AWS S3.
 * Pertenece a la capa de infraestructura; el dominio no la conoce.
 */
export class S3SaveRepository implements SaveRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  async getUploadUrl(
    userId: string,
    gameId: string,
    filename: string
  ): Promise<string> {
    const key = `${userId}/${gameId}/${filename}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });
  }

  async getDownloadUrl(
    _userId: string,
    _gameId: string,
    key: string
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });
  }

  async getUploadUrls(
    userId: string,
    items: UploadUrlItem[]
  ): Promise<UploadUrlResult[]> {
    if (items.length === 0) return [];
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };
    const results = await Promise.all(
      items.map(async ({ gameId, filename }) => {
        const key = `${userId}/${gameId}/${filename}`;
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });
        const uploadUrl = await getSignedUrl(this.s3, command, options);
        return { uploadUrl, key, gameId, filename };
      })
    );
    return results;
  }

  async getDownloadUrls(
    userId: string,
    items: DownloadUrlItem[]
  ): Promise<DownloadUrlResult[]> {
    if (items.length === 0) return [];
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };
    const results = await Promise.all(
      items.map(async ({ gameId, key }) => {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });
        const downloadUrl = await getSignedUrl(this.s3, command, options);
        return { downloadUrl, gameId, key };
      })
    );
    return results;
  }

  async listByUser(userId: string): Promise<GameSave[]> {
    const prefix = `${userId}/`;
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
    });

    const response = await this.s3.send(command);
    const contents = response.Contents ?? [];

    const saves: GameSave[] = contents
      .filter(
        (obj): obj is { Key: string; LastModified?: Date; Size?: number } =>
          !!obj.Key
      )
      .map((obj) => ({
        gameId: obj.Key!.split("/")[1] ?? "",
        key: obj.Key!,
        lastModified: obj.LastModified ?? new Date(0),
        size: obj.Size,
      }));

    return saves;
  }
}
