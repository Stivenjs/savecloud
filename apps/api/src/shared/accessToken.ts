import { createHmac, timingSafeEqual } from "crypto";

type AccessTokenPayloadV1 = {
  v: 1;
  sub: string; // userId
  exp: number; // unix seconds
};

export type VerifiedToken = Readonly<{ userId: string; exp: number }>;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function getSecret(): string {
  return process.env.ACCESS_TOKEN_SECRET?.trim() || process.env.API_KEY?.trim() || "";
}

/**
 * Firma `data` con HMAC-SHA256 y devuelve bytes crudos en un Buffer.
 * Comparar buffers de bytes (no strings) hace que timingSafeEqual sea correcto.
 */
function signToBuffer(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/**
 * Emite un token de acceso firmado para `userId` con TTL en segundos.
 * Si ttlSeconds === 0, emite un token sin caducidad (permanente para membresía de nube).
 * Lanza si el secreto no está configurado o si los argumentos son inválidos.
 */
export function issueUserAccessToken(userId: string, ttlSeconds: number = 0): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error("ACCESS_TOKEN_SECRET (or API_KEY) is not configured");
  }

  const trimmed = userId.trim();
  if (!trimmed) {
    throw new Error("userId must not be empty");
  }

  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    throw new Error(`ttlSeconds must be a finite number ≥ 0, got: ${ttlSeconds}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayloadV1 = {
    v: 1,
    sub: trimmed,
    exp: ttlSeconds > 0 ? now + ttlSeconds : 0,
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(signToBuffer(secret, body));
  return `sc1.${body}.${sig}`;
}

/**
 * Verifica la firma y la vigencia del token.
 * Devuelve `{ userId, exp }` si la firma HMAC del servidor es válida, o `null` en cualquier otro caso.
 */
export function verifyUserAccessToken(token: string): VerifiedToken | null {
  const secret = getSecret();
  if (!secret) {
    console.error("[auth:token] FATAL: ACCESS_TOKEN_SECRET/API_KEY is not set — cannot verify tokens");
    return null;
  }

  const raw = token.trim();

  const firstDot = raw.indexOf(".");
  const lastDot = raw.lastIndexOf(".");
  if (firstDot === lastDot || firstDot === -1) return null;

  const prefix = raw.slice(0, firstDot);
  const body = raw.slice(firstDot + 1, lastDot);
  const sig = raw.slice(lastDot + 1);

  if (prefix !== "sc1" || !body || !sig) return null;

  const expectedSigBuf = signToBuffer(secret, body);
  let receivedSigBuf: Buffer;
  try {
    receivedSigBuf = base64UrlDecodeToBuffer(sig);
  } catch {
    return null;
  }

  if (receivedSigBuf.length !== expectedSigBuf.length) return null;
  if (!timingSafeEqual(receivedSigBuf, expectedSigBuf)) return null;

  let parsed: AccessTokenPayloadV1;
  try {
    const json = base64UrlDecodeToBuffer(body).toString("utf8");
    parsed = JSON.parse(json) as AccessTokenPayloadV1;
  } catch {
    return null;
  }

  if (!parsed || parsed.v !== 1) return null;
  if (typeof parsed.sub !== "string" || !parsed.sub.trim()) return null;
  if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;

  return Object.freeze({ userId: parsed.sub.trim(), exp: parsed.exp });
}
