import { createHmac, timingSafeEqual } from "crypto";

type AccessTokenPayloadV1 = {
  v: 1;
  sub: string; // userId
  exp: number; // unix seconds
};

type AccessTokenPayloadV2 = {
  v: 2;
  sub: string;
  sid: string;
  aud: string;
  exp: number;
};

export type VerifiedToken = Readonly<{ userId: string; exp: number; sessionId?: string; hostUserId?: string }>;

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
  return process.env.ACCESS_TOKEN_SECRET?.trim() || "";
}

/**
 * Firma `data` con HMAC-SHA256 y devuelve bytes crudos en un Buffer.
 * Comparar buffers de bytes (no strings) hace que timingSafeEqual sea correcto.
 */
function signToBuffer(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/**
 * Emite un token de acceso firmado para una sesión concreta, vinculado al usuario y a su nube.
 * El token siempre tiene caducidad; la renovación usa un refresh token rotativo persistido aparte.
 * Lanza si el secreto no está configurado o si los argumentos son inválidos.
 */
export function issueUserAccessToken(
  userId: string,
  sessionId: string,
  hostUserId: string,
  ttlSeconds: number = 15 * 60
): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error("ACCESS_TOKEN_SECRET is not configured");
  }

  const trimmed = userId.trim();
  if (!trimmed) {
    throw new Error("userId must not be empty");
  }

  const normalizedSessionId = sessionId.trim();
  const normalizedHostUserId = hostUserId.trim();
  if (!normalizedSessionId || !normalizedHostUserId) {
    throw new Error("sessionId and hostUserId must not be empty");
  }

  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`ttlSeconds must be a finite number > 0, got: ${ttlSeconds}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayloadV2 = {
    v: 2,
    sub: trimmed,
    sid: normalizedSessionId,
    aud: normalizedHostUserId,
    exp: now + ttlSeconds,
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(signToBuffer(secret, body));
  return `sc2.${body}.${sig}`;
}

/**
 * Verifica la firma y la vigencia del token.
 * Devuelve identidad, sesión y expiración si el token es válido; nunca acepta tokens sin caducidad.
 */
export function verifyUserAccessToken(token: string): VerifiedToken | null {
  const secret = getSecret();
  if (!secret) {
    console.error("[auth:token] FATAL: ACCESS_TOKEN_SECRET is not set — cannot verify guest sessions");
    return null;
  }

  const raw = token.trim();

  const firstDot = raw.indexOf(".");
  const lastDot = raw.lastIndexOf(".");
  if (firstDot === lastDot || firstDot === -1) return null;

  const prefix = raw.slice(0, firstDot);
  const body = raw.slice(firstDot + 1, lastDot);
  const sig = raw.slice(lastDot + 1);

  if (prefix !== "sc2" || !body || !sig) return null;

  const expectedSigBuf = signToBuffer(secret, body);
  let receivedSigBuf: Buffer;
  try {
    receivedSigBuf = base64UrlDecodeToBuffer(sig);
  } catch {
    return null;
  }

  if (receivedSigBuf.length !== expectedSigBuf.length) return null;
  if (!timingSafeEqual(receivedSigBuf, expectedSigBuf)) return null;

  let parsed: AccessTokenPayloadV2;
  try {
    const json = base64UrlDecodeToBuffer(body).toString("utf8");
    parsed = JSON.parse(json) as AccessTokenPayloadV2;
  } catch {
    return null;
  }

  if (!parsed || parsed.v !== 2) return null;
  if (typeof parsed.sub !== "string" || !parsed.sub.trim()) return null;
  if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  if (typeof parsed.sid !== "string" || !parsed.sid.trim()) return null;
  if (typeof parsed.aud !== "string" || !parsed.aud.trim()) return null;

  return Object.freeze({
    userId: parsed.sub.trim(),
    exp: parsed.exp,
    sessionId: parsed.sid.trim(),
    hostUserId: parsed.aud.trim(),
  });
}

/** Valida temporalmente los tokens sc1 ya emitidos para facilitar su migración. */
export function verifyLegacyUserAccessToken(token: string): VerifiedToken | null {
  const secret = process.env.API_KEY?.trim() ?? "";
  if (!secret) return null;

  const raw = token.trim();
  const firstDot = raw.indexOf(".");
  const lastDot = raw.lastIndexOf(".");
  if (firstDot === lastDot || firstDot === -1 || raw.slice(0, firstDot) !== "sc1") return null;

  const body = raw.slice(firstDot + 1, lastDot);
  const signature = raw.slice(lastDot + 1);
  if (!body || !signature) return null;

  const expected = signToBuffer(secret, body);
  let received: Buffer;
  try {
    received = base64UrlDecodeToBuffer(signature);
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let parsed: AccessTokenPayloadV1;
  try {
    parsed = JSON.parse(base64UrlDecodeToBuffer(body).toString("utf8")) as AccessTokenPayloadV1;
  } catch {
    return null;
  }
  if (parsed.v !== 1 || !parsed.sub?.trim() || typeof parsed.exp !== "number") return null;
  if (parsed.exp !== 0 && parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  return Object.freeze({ userId: parsed.sub.trim(), exp: parsed.exp });
}
