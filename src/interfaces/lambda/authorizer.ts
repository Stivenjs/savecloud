/**
 * Lambda authorizer para API Gateway HTTP API.
 * Valida x-api-key antes de invocar la Lambda principal.
 * Formato de respuesta: 2.0 simple (isAuthorized).
 */

const expectedApiKey = process.env.API_KEY ?? "";

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === lower) {
      const val = v;
      return Array.isArray(val) ? val[0] ?? "" : (val ?? "");
    }
  }
  return "";
}

export async function handler(event: {
  version?: string;
  type?: string;
  rawPath?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestContext?: { http?: { path?: string; method?: string } };
}): Promise<{ isAuthorized: boolean }> {
  const rawPath = event.rawPath ?? event.requestContext?.http?.path ?? "";
  const method = (event.requestContext?.http?.method ?? "").toUpperCase();
  if (rawPath === "/health") {
    return { isAuthorized: true };
  }
  // CORS preflight: el navegador no envía x-api-key en OPTIONS
  if (method === "OPTIONS") {
    return { isAuthorized: true };
  }
  // GET /share/:token es público (resolver link compartido sin auth)
  if (method === "GET" && rawPath.startsWith("/share/") && rawPath.length > "/share/".length) {
    return { isAuthorized: true };
  }

  if (!expectedApiKey) {
    return { isAuthorized: true };
  }

  const key = getHeader(event.headers ?? {}, "x-api-key");
  return { isAuthorized: key === expectedApiKey };
}
