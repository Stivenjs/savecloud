import { createHmac, timingSafeEqual } from "node:crypto";
import { TtlCache } from "@shared/ttlCache";

/**
 * Prefijo canónico que identifica un token de acceso versión 2 firmado (`sc2`).
 */
export const TOKEN_V2_PREFIX = "sc2.";

/**
 * Prefijo canónico que identifica un token de acceso versión 1 legado (`sc1`).
 */
export const TOKEN_V1_PREFIX = "sc1.";

/**
 * Longitud en bytes del digest binario de un HMAC-SHA256 (256 bits = 32 bytes).
 */
const HMAC_SHA256_BYTE_LENGTH = 32;

/**
 * Longitud exacta en caracteres de una firma HMAC-SHA256 codificada en `base64url` sin padding:
 * ceil(32 * 4 / 3) = 43 caracteres.
 */
const BASE64URL_SIGNATURE_LENGTH = 43;

/**
 * Longitud mínima esperada para un token de acceso:
 * Prefijo 'sc2.' (4) + carga mínima en base64url (~40) + separador '.' (1) + firma base64url (43) = ~88 caracteres.
 */
const MIN_TOKEN_LENGTH = 50;

/**
 * TTL en milisegundos para la caché in-memory de tokens verificados (30 segundos).
 * Acelera drásticamente las ráfagas de solicitudes concurrentes de un mismo cliente.
 */
const TOKEN_CACHE_TTL_MS = 30_000;

/**
 * Caché en memoria para validaciones criptográficas de tokens de acceso (`sc2`).
 * Evita repetir el cómputo de HMAC-SHA256 y JSON.parse en cada solicitud HTTP de un cliente autenticado.
 */
const tokenVerificationCache = new TtlCache<string, VerifiedToken>({
  ttlMs: TOKEN_CACHE_TTL_MS,
  maxEntries: 2_000,
});

/**
 * Estructura de la carga útil (claims) de un token de acceso legado v1.
 */
type AccessTokenPayloadV1 = {
  v: 1;
  sub: string; // userId
  exp: number; // unix seconds (0 = sin caducidad)
};

/**
 * Estructura de la carga útil (claims) de un token de acceso moderno v2.
 */
type AccessTokenPayloadV2 = {
  v: 2;
  sub: string; // userId del miembro
  sid: string; // sessionId vinculado
  aud: string; // hostUserId propietario de la nube
  exp: number; // unix seconds
};

/**
 * Representación inmutable de la identidad y permisos decodificados de un token de acceso válido.
 */
export type VerifiedToken = Readonly<{
  userId: string;
  exp: number;
  sessionId?: string;
  hostUserId?: string;
}>;

/**
 * Limpia la caché interna de tokens de acceso verificados.
 * Útil para pruebas automatizadas o ante rotación forzada de claves.
 */
export function clearAccessTokenVerificationCache(): void {
  tokenVerificationCache.clear();
}

/**
 * Obtiene el secreto criptográfico configurado para la firma y verificación de tokens de acceso `sc2`.
 *
 * @returns El secreto configurado en el entorno o una cadena vacía si no existe.
 */
function getSecret(): string {
  return process.env.ACCESS_TOKEN_SECRET?.trim() || "";
}

/**
 * Genera la firma HMAC-SHA256 de una cadena y la devuelve en un `Buffer` crudo de 32 bytes.
 *
 * Comparar buffers de bytes crudos (no strings) garantiza que `timingSafeEqual`
 * opere en tiempo constante real sobre una longitud fija predecible.
 *
 * @param secret - Clave secreta compartida para la firma HMAC.
 * @param data - Datos de entrada a firmar.
 * @returns Búfer con los 32 bytes del digest binario.
 */
function signToBuffer(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/**
 * Genera la firma HMAC-SHA256 de una cadena y la codifica directamente en `base64url`.
 *
 * Emplea el método nativo de Node.js/Bun para evitar asignaciones intermedias de memoria.
 *
 * @param secret - Clave secreta compartida.
 * @param data - Datos a firmar.
 * @returns Cadena de 43 caracteres con la firma en formato base64url.
 */
function signToBase64Url(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Emite un token de acceso criptográfico firmado (`sc2.<payload>.<sig>`).
 *
 * Vincula al usuario con una sesión revocable concreta y un anfitrión (`aud`).
 * El token siempre incluye una marca temporal de caducidad finita (`exp`).
 *
 * @param userId - Identificador de usuario del miembro invitado.
 * @param sessionId - Identificador UUID de la sesión activa en la base de datos.
 * @param hostUserId - Identificador de usuario del host propietario de la nube.
 * @param ttlSeconds - Tiempo de vida en segundos del token (por defecto: 15 minutos = 900 s).
 * @returns El token de acceso firmado en formato compacto `sc2.<base64url>.<base64url>`.
 * @throws {Error} Si el secreto no está configurado o los argumentos son inválidos.
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

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
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
    sub: normalizedUserId,
    sid: normalizedSessionId,
    aud: normalizedHostUserId,
    exp: now + ttlSeconds,
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signToBase64Url(secret, body);

  return `${TOKEN_V2_PREFIX}${body}.${sig}`;
}

/**
 * Verifica la autenticidad, integridad y vigencia de un token de acceso `sc2`.
 *
 * @param token - Cadena de texto recibida en la cabecera `Authorization: Bearer <token>`.
 * @returns Los claims verificados inmutables (`VerifiedToken`) o `null` si el token es inválido o expiró.
 */
export function verifyUserAccessToken(token: string): VerifiedToken | null {
  if (typeof token !== "string") {
    return null;
  }

  const raw = token.trim();
  if (raw.length < MIN_TOKEN_LENGTH || !raw.startsWith(TOKEN_V2_PREFIX)) {
    return null;
  }

  const secret = getSecret();
  if (!secret) {
    console.error("[auth:token] FATAL: ACCESS_TOKEN_SECRET is not set — cannot verify guest sessions");
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  const cacheKey = `${secret}::${raw}`;
  const cached = tokenVerificationCache.get(cacheKey);
  if (cached) {
    if (cached.exp > now) {
      return cached;
    }
    tokenVerificationCache.delete(cacheKey);
    return null;
  }

  const firstDot = 3; // Posición del punto en "sc2."
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= firstDot) {
    return null;
  }

  const body = raw.slice(firstDot + 1, lastDot);
  const sig = raw.slice(lastDot + 1);

  if (!body || sig.length !== BASE64URL_SIGNATURE_LENGTH) {
    return null;
  }

  const expectedSigBuf = signToBuffer(secret, body);
  let receivedSigBuf: Buffer;
  try {
    receivedSigBuf = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  if (receivedSigBuf.length !== HMAC_SHA256_BYTE_LENGTH || !timingSafeEqual(receivedSigBuf, expectedSigBuf)) {
    return null;
  }

  let parsed: AccessTokenPayloadV2;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    parsed = JSON.parse(json) as AccessTokenPayloadV2;
  } catch {
    return null;
  }

  if (
    !parsed ||
    parsed.v !== 2 ||
    typeof parsed.sub !== "string" ||
    !parsed.sub.trim() ||
    typeof parsed.exp !== "number" ||
    !Number.isFinite(parsed.exp) ||
    parsed.exp <= now ||
    typeof parsed.sid !== "string" ||
    !parsed.sid.trim() ||
    typeof parsed.aud !== "string" ||
    !parsed.aud.trim()
  ) {
    return null;
  }

  const verified: VerifiedToken = Object.freeze({
    userId: parsed.sub.trim(),
    exp: parsed.exp,
    sessionId: parsed.sid.trim(),
    hostUserId: parsed.aud.trim(),
  });

  tokenVerificationCache.set(cacheKey, verified);

  return verified;
}

/**
 * Valida temporalmente los tokens de acceso legados de versión 1 (`sc1`) para permitir su migración a v2.
 *
 * Utiliza la clave maestra `API_KEY` del entorno como secreto de validación.
 *
 * @param token - Token legado a comprobar (`sc1.<bodyBase64Url>.<signature>`).
 * @returns Datos básicos del usuario si la firma y expiración son válidas; de lo contrario `null`.
 */
export function verifyLegacyUserAccessToken(token: string): VerifiedToken | null {
  if (typeof token !== "string") {
    return null;
  }

  const raw = token.trim();
  if (raw.length < MIN_TOKEN_LENGTH || !raw.startsWith(TOKEN_V1_PREFIX)) {
    return null;
  }

  const secret = process.env.API_KEY?.trim() ?? "";
  if (!secret) {
    return null;
  }

  const firstDot = 3; // Posición del punto en "sc1."
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= firstDot) {
    return null;
  }

  const body = raw.slice(firstDot + 1, lastDot);
  const signature = raw.slice(lastDot + 1);

  if (!body || signature.length !== BASE64URL_SIGNATURE_LENGTH) {
    return null;
  }

  const expected = signToBuffer(secret, body);
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }

  if (received.length !== HMAC_SHA256_BYTE_LENGTH || !timingSafeEqual(received, expected)) {
    return null;
  }

  let parsed: AccessTokenPayloadV1;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessTokenPayloadV1;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !parsed ||
    parsed.v !== 1 ||
    typeof parsed.sub !== "string" ||
    !parsed.sub.trim() ||
    typeof parsed.exp !== "number" ||
    !Number.isFinite(parsed.exp) ||
    (parsed.exp !== 0 && parsed.exp <= now)
  ) {
    return null;
  }

  return Object.freeze({
    userId: parsed.sub.trim(),
    exp: parsed.exp,
  });
}
