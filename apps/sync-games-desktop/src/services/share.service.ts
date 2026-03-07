/**
 * Llamadas a la API de compartir por link (POST /share, GET /share/:token).
 * Se ejecutan desde el frontend con fetch.
 */

export interface CreateShareResult {
  token: string;
  shareUrl: string;
}

export interface ResolveShareResult {
  userId: string;
  gameId: string;
}

export async function createShareLink(
  apiBaseUrl: string,
  userId: string,
  apiKey: string,
  gameId: string,
  expiresInDays?: number
): Promise<CreateShareResult> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ gameId, expiresInDays }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      (err as { message?: string }).message ?? "No se pudo crear el link"
    );
  }
  return res.json() as Promise<CreateShareResult>;
}

export async function resolveShareToken(
  apiBaseUrl: string,
  token: string
): Promise<ResolveShareResult> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/share/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      (err as { message?: string }).message ?? "Link inválido o expirado"
    );
  }
  return res.json() as Promise<ResolveShareResult>;
}

/** Extrae el token de una URL de compartir (ej. https://api.../share/abc123 o solo abc123). */
export function extractShareTokenFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/share\/([a-f0-9]+)/i);
  if (match) return match[1];
  if (/^[a-f0-9]{48}$/i.test(trimmed)) return trimmed;
  return null;
}
