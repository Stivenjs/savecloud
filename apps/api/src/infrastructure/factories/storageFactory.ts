import { S3Client } from "@aws-sdk/client-s3";

/** Nombre del bucket de S3 por defecto en entorno de desarrollo */
const DEFAULT_BUCKET_NAME = "savecloud-saves-dev";

/** Región de AWS por defecto */
const DEFAULT_AWS_REGION = "us-east-2";

/**
 * Obtiene el nombre del bucket de S3 configurado en las variables de entorno.
 *
 * @returns Nombre del bucket de S3 (`BUCKET_NAME`) o `"savecloud-saves-dev"` por defecto.
 */
export function getBucketName(): string {
  return process.env.BUCKET_NAME?.trim() || DEFAULT_BUCKET_NAME;
}

/**
 * Crea una instancia del cliente de AWS S3 (`S3Client`) para comunicaciones internas o personalizadas.
 *
 * Configura la región, el endpoint (MinIO o AWS S3 nativo), autenticación y direccionamiento path-style.
 *
 * @param endpointOverride - Endpoint opcional para sobrescribir la URL por defecto de S3 (`S3_ENDPOINT`).
 * @returns Instancia configurada de `S3Client`.
 */
export function createS3Client(endpointOverride?: string): S3Client {
  const awsRegion = process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION;
  const s3Endpoint = endpointOverride ?? (process.env.S3_ENDPOINT?.trim() || undefined);
  const isForcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(s3Endpoint);
  const useAccelerateEndpoint = process.env.USE_ACCELERATE_ENDPOINT === "true";

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  return new S3Client({
    region: awsRegion,
    endpoint: s3Endpoint,
    forcePathStyle: isForcePathStyle,
    useAccelerateEndpoint: s3Endpoint ? false : useAccelerateEndpoint,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
}

/**
 * Crea una instancia dedicada de `S3Client` para la generación de URLs pre-firmadas públicas (`getSignedUrl`).
 *
 * Garantiza que la firma criptográfica HMAC contenga el encabezado `Host:` correspondiente al endpoint público
 * accesible por los clientes externos (`S3_PUBLIC_ENDPOINT` o `PUBLIC_S3_ENDPOINT`), evitando
 * errores de firma (`403 Forbidden`).
 *
 * @returns Instancia configurada de `S3Client` adaptada para presignados públicos.
 */
export function createPresignS3Client(): S3Client {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.PUBLIC_S3_ENDPOINT?.trim();
  if (!publicEndpoint) {
    return createS3Client();
  }
  return createS3Client(publicEndpoint);
}

/**
 * Mapea una URL interna de S3 reemplazando el endpoint interno por el endpoint público accesible.
 *
 * @param url - URL original generada con el endpoint interno de S3.
 * @returns URL transformada con el dominio/puerto público configurado en `S3_PUBLIC_ENDPOINT`.
 */
export function resolvePublicUrl(url: string): string {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.PUBLIC_S3_ENDPOINT?.trim();
  const internalEndpoint = process.env.S3_ENDPOINT?.trim();

  if (publicEndpoint && internalEndpoint && url.startsWith(internalEndpoint)) {
    return url.replace(internalEndpoint, publicEndpoint);
  }
  return url;
}
