import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_EXPIRES_IN_SECONDS } from "@infrastructure/persistence/S3SaveRepository";

type SeedState = {
  version: 1;
  priorityLine: number;
  priorityDone: boolean;
  manifestPart: number;
  manifestLine: number;
  batchSeq: number;
  backoffUntil: string | null;
  catalogComplete: boolean;
  totals: {
    processed: number;
    steamOk: number;
    steamNotFound: number;
    httpErrors: number;
  };
};

function defaultState(): SeedState {
  return {
    version: 1,
    priorityLine: 0,
    priorityDone: false,
    manifestPart: 0,
    manifestLine: 0,
    batchSeq: 0,
    backoffUntil: null,
    catalogComplete: false,
    totals: {
      processed: 0,
      steamOk: 0,
      steamNotFound: 0,
      httpErrors: 0,
    },
  };
}

export class S3SteamSeedRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  private basePrefix(ownerId: string): string {
    const clean = ownerId.trim();
    if (!clean) throw new Error("ownerId is required");
    return `steam-seed/${clean}/`;
  }

  private assertOwnedKey(ownerId: string, key: string): void {
    const prefix = this.basePrefix(ownerId);
    if (!key.startsWith(prefix) || key.includes("..")) {
      throw new Error("Invalid key: must belong to owner seed prefix");
    }
  }

  async getManifestUploadUrl(ownerId: string, partIndex: number): Promise<{ uploadUrl: string; key: string }> {
    if (!Number.isFinite(partIndex) || partIndex < 0) {
      throw new Error("partIndex must be >= 0");
    }
    const key = `${this.basePrefix(ownerId)}manifest/part-${String(partIndex).padStart(5, "0")}.txt`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: "text/plain; charset=utf-8",
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
    return { uploadUrl, key };
  }

  async getPriorityUploadUrl(ownerId: string): Promise<{ uploadUrl: string; key: string }> {
    const key = `${this.basePrefix(ownerId)}priority_appids.jsonl`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: "text/plain; charset=utf-8",
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
    return { uploadUrl, key };
  }

  async resetState(ownerId: string): Promise<void> {
    const key = `${this.basePrefix(ownerId)}state.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(defaultState()),
        ContentType: "application/json",
      })
    );
  }

  async listBatchKeys(
    ownerId: string,
    maxKeys: number = 200,
    continuationToken?: string
  ): Promise<{ keys: string[]; nextCursor?: string }> {
    const prefix = `${this.basePrefix(ownerId)}batches/`;
    const out = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: Math.max(1, Math.min(1000, maxKeys)),
        ContinuationToken: continuationToken,
      })
    );
    const keys = (out.Contents ?? [])
      .map((x) => x.Key)
      .filter((k): k is string => !!k)
      .sort();
    return {
      keys,
      nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }

  async getBatchDownloadUrl(ownerId: string, key: string): Promise<string> {
    this.assertOwnedKey(ownerId, key);
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
  }
}
