/** Mapea URLs S3 internas o locales al endpoint público configurado para los clientes. */
export function resolvePublicUrl(url: string): string {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.PUBLIC_S3_ENDPOINT?.trim();
  const internalEndpoint = process.env.S3_ENDPOINT?.trim();

  if (!publicEndpoint) return url;

  const knownInternalEndpoints = [
    internalEndpoint,
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://minio:9000",
  ]
    .filter((endpoint): endpoint is string => Boolean(endpoint))
    .map((endpoint) => endpoint.replace(/\/$/, ""));

  for (const endpoint of knownInternalEndpoints) {
    if (url === endpoint || url.startsWith(`${endpoint}/`) || url.startsWith(`${endpoint}?`)) {
      return `${publicEndpoint.replace(/\/$/, "")}${url.slice(endpoint.length)}`;
    }
  }

  return url;
}
