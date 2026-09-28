/** Mapea una URL interna de S3 al endpoint público configurado para los clientes. */
export function resolvePublicUrl(url: string): string {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.PUBLIC_S3_ENDPOINT?.trim();
  const internalEndpoint = process.env.S3_ENDPOINT?.trim();

  if (publicEndpoint && internalEndpoint && url.startsWith(internalEndpoint)) {
    return url.replace(internalEndpoint, publicEndpoint);
  }
  return url;
}
