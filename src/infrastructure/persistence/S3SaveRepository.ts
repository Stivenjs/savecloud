import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { GameSave } from "@domain/entities/GameSave";
import type {
  CompletedPart,
  CreateMultipartUploadResult,
  DownloadUrlItem,
  DownloadUrlResult,
  SaveRepository,
  UploadPartUrl,
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
    key: string,
    range?: { start: number; end: number }
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...(range != null && {
        Range: `bytes=${range.start}-${range.end}`,
      }),
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
    if (!this.bucketName || !this.bucketName.trim()) {
      throw new Error("BUCKET_NAME no está configurado en el servidor");
    }
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

  async createMultipartUpload(
    userId: string,
    gameId: string,
    filename: string
  ): Promise<CreateMultipartUploadResult> {
    const key = `${userId}/${gameId}/${filename}`;
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    const { UploadId } = await this.s3.send(command);
    if (!UploadId) throw new Error("S3 did not return UploadId");
    return { uploadId: UploadId, key };
  }

  async createMultipartUploadWithPartUrls(
    userId: string,
    gameId: string,
    filename: string,
    partCount: number
  ): Promise<CreateMultipartUploadResult & { partUrls: UploadPartUrl[] }> {
    const result = await this.createMultipartUpload(userId, gameId, filename);
    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
    const partUrls = await this.getUploadPartUrls(
      result.key,
      result.uploadId,
      partNumbers
    );
    return { ...result, partUrls };
  }

  async getUploadPartUrls(
    key: string,
    uploadId: string,
    partNumbers: number[]
  ): Promise<UploadPartUrl[]> {
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };
    const partUrls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(this.s3, command, options);
        return { partNumber, url };
      })
    );
    return partUrls;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    });
    await this.s3.send(command);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
    });
    await this.s3.send(command);
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

  async deleteGame(userId: string, gameId: string): Promise<void> {
    const prefix = `${userId}/${gameId}/`;
    let continuationToken: string | undefined;
    do {
      const list = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      const contents = list.Contents ?? [];
      if (contents.length === 0) break;
      const keys = contents
        .filter((c): c is { Key: string } => !!c.Key)
        .map((c) => ({ Key: c.Key! }));
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: { Objects: keys, Quiet: true },
        })
      );
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  async renameGame(
    userId: string,
    oldGameId: string,
    newGameId: string
  ): Promise<void> {
    if (oldGameId === newGameId) return;
    const prefix = `${userId}/${oldGameId}/`;
    const keysToDelete: { Key: string }[] = [];
    let continuationToken: string | undefined;
    do {
      const list = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      const contents = list.Contents ?? [];
      for (const obj of contents) {
        if (!obj.Key) continue;
        const filename = obj.Key.slice(prefix.length);
        const newKey = `${userId}/${newGameId}/${filename}`;
        await this.s3.send(
          new CopyObjectCommand({
            Bucket: this.bucketName,
            CopySource: `${this.bucketName}/${encodeURIComponent(obj.Key)}`,
            Key: newKey,
          })
        );
        keysToDelete.push({ Key: obj.Key });
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);

    for (let i = 0; i < keysToDelete.length; i += 1000) {
      const batch = keysToDelete.slice(i, i + 1000);
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: { Objects: batch, Quiet: true },
        })
      );
    }
  }
}
