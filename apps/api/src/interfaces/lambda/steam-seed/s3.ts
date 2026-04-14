import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";

/**
 * Convierte el `Body` de S3 (stream/bytes/string) a string UTF-8.
 */
export async function s3BodyToString(body: unknown): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
}

/**
 * Detecta el error estándar de S3 cuando un objeto no existe.
 */
export function isNoSuchKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "NoSuchKey";
}

/**
 * Lee un objeto de S3 y devuelve su contenido como string.
 */
export async function getObjectText(s3: S3Client, bucket: string, key: string): Promise<string> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return s3BodyToString(out.Body);
}

/**
 * Lee un objeto de S3; devuelve `null` si no existe.
 */
export async function tryGetObjectText(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  try {
    return await getObjectText(s3, bucket, key);
  } catch (e) {
    if (isNoSuchKey(e)) return null;
    throw e;
  }
}

/**
 * Escribe un objeto JSON en S3.
 */
export async function putJson(s3: S3Client, bucket: string, key: string, value: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    })
  );
}

/**
 * Lista objetos con prefijo (helper thin wrapper).
 */
export async function listObjects(
  s3: S3Client,
  bucket: string,
  params: { prefix: string; delimiter?: string; continuationToken?: string; maxKeys?: number }
): Promise<{
  keys: string[];
  commonPrefixes: string[];
  nextContinuationToken?: string;
}> {
  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: params.prefix,
      ...(params.delimiter ? { Delimiter: params.delimiter } : {}),
      ...(params.continuationToken ? { ContinuationToken: params.continuationToken } : {}),
      ...(params.maxKeys ? { MaxKeys: params.maxKeys } : {}),
    })
  );

  const keys = (out.Contents ?? []).map((x) => x.Key).filter((k): k is string => !!k);
  const commonPrefixes = (out.CommonPrefixes ?? []).map((x) => x.Prefix).filter((p): p is string => !!p);

  return {
    keys,
    commonPrefixes,
    nextContinuationToken: out.IsTruncated ? out.NextContinuationToken : undefined,
  };
}
