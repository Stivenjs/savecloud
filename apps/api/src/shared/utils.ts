import type { FastifyRequest } from "fastify";

const USER_ID_HEADER = "x-user-id";

export function getUserId(request: FastifyRequest): string {
  const userId = request.headers[USER_ID_HEADER];
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Missing or invalid x-user-id header");
  }
  return userId.trim();
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err != null &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  if (err != null && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
  return String(err);
}

function firstHeaderValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return null;
}

export function resolvePublicBaseUrl(request: FastifyRequest): string {
  const xfProtoRaw = firstHeaderValue(request.headers?.["x-forwarded-proto"]);
  const xfHostRaw = firstHeaderValue(request.headers?.["x-forwarded-host"]);
  const hostRaw = firstHeaderValue(request.headers?.host);

  const proto = (xfProtoRaw?.split(",")[0]?.trim() || request.protocol || "https").toLowerCase();
  const host = xfHostRaw?.split(",")[0]?.trim() || hostRaw || request.hostname;

  // En edge/public internet preferimos HTTPS para enlaces compartibles.
  const safeProto = proto === "http" ? "https" : proto;
  return `${safeProto}://${host}`;
}

function isLikelySlug(value: string): boolean {
  return !value.includes(" ") && /[-_]/.test(value);
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Normaliza el nombre del juego para presencia/notificaciones.
 *
 * - Si `providedGameName` ya viene legible, se respeta.
 * - Si viene como slug técnico (`resident-evil-4`), lo humaniza.
 * - Si no hay nombre, deriva desde `gameId`.
 */
export function normalizeGameDisplayName(gameId: string, providedGameName?: string | null): string {
  const rawName = (providedGameName ?? "").trim();
  const rawGameId = gameId.trim();
  const source = rawName || rawGameId;

  if (!source) return "";

  // Si ya viene legible y no parece slug, lo dejamos tal cual.
  if (rawName && !isLikelySlug(rawName)) {
    return rawName;
  }

  let cleaned = source;

  // Quitar sufijo tipo Steam App ID: resident-evil-4-2050650
  cleaned = cleaned.replace(/[-_]\d{4,10}$/g, "");

  // Quitar sufijos técnicos frecuentes de releases.
  cleaned = cleaned.replace(/[-_](crack|repack|rip|p2p|x64|x86|v\d+[.\d]*|build-?\d+|multi\d+).*$/i, "");

  // Normalizar separadores y capitalización final.
  cleaned = cleaned.replace(/[-_]+/g, " ").trim();

  return titleCaseWords(cleaned || source.replace(/[-_]+/g, " "));
}
