/**
 * Resuelve las credenciales de AWS a partir de las variables de entorno.
 *
 * Soporta claves permanentes (`AKIA...`), credenciales temporales de STS / AWS Lambda (`ASIA...` + `AWS_SESSION_TOKEN`),
 * y fallbacks para emuladores locales (MinIO, DynamoDB Local).
 *
 * @param defaultFallback - Clave simulada por defecto en caso de entornos locales (ej. "local").
 */
export function resolveAwsCredentials(
  defaultFallback?: string
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() || defaultFallback;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || defaultFallback;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  if (!accessKeyId || !secretAccessKey) {
    return undefined;
  }

  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}
