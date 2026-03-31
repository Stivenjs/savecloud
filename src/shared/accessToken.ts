import { createHmac, timingSafeEqual } from "crypto";

type AccessTokenPayloadV1 = {
  v: 1;
  sub: string; // userId
  exp: number; // unix seconds
};

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
  // Si quieres rotar sin tocar el API_KEY global, define ACCESS_TOKEN_SECRET.
  return process.env.ACCESS_TOKEN_SECRET?.trim() || process.env.API_KEY?.trim() || "";
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueUserAccessToken(userId: string, ttlSeconds: number): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error("ACCESS_TOKEN_SECRET (or API_KEY) is not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayloadV1 = {
    v: 1,
    sub: userId.trim(),
    exp: now + Math.max(60, ttlSeconds),
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(secret, body);
  return `sc1.${body}.${sig}`;
}

export function verifyUserAccessToken(token: string): { userId: string; exp: number } | null {
  const secret = getSecret();
  if (!secret) return null;

  const raw = token.trim();
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [prefix, body, sig] = parts;
  if (prefix !== "sc1") return null;
  if (!body || !sig) return null;

  const expectedSig = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

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

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp <= now) return null;

  return { userId: parsed.sub.trim(), exp: parsed.exp };
}
