import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import { issueUserAccessToken } from "@shared/accessToken";

/**
 * Tiempo de vida (TTL) del token de acceso corto (`sc2`), en segundos.
 * Valor por defecto: 1 hora (3600 segundos).
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Tiempo de vida (TTL) de la sesión persistente de renovación (`scr1`), en segundos.
 * Valor por defecto: 30 días.
 */
export const REFRESH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Longitud exacta de un hash SHA-256 codificado en formato hexadecimal (64 caracteres = 32 bytes). */
const SHA256_HEX_LENGTH = 64;

/**
 * Prefijo canónico que identifica un Refresh Token rotativo versión 1 (`scr1`).
 */
const REFRESH_TOKEN_PREFIX = "scr1.";

/**
 * Longitud mínima esperada para un Refresh Token:
 * Prefijo 'scr1.' (5) + UUID v4 (36) + separador '.' (1) + secreto base64url (mínimo 40) = 82 caracteres.
 */
const MIN_REFRESH_TOKEN_LENGTH = 82;

/**
 * Expresión regular precompilada a nivel de módulo para validar y descomponer
 * de forma estricta los tokens de renovación rotativos (`scr1.<uuid>.<secret>`).
 */
const REFRESH_TOKEN_REGEX =
  /^scr1\.([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.([A-Za-z0-9_-]{40,})$/;

/**
 * Par de tokens y metadatos temporales emitidos al iniciar o rotar una sesión de acceso.
 */
export interface AccessSessionTokens {
  /** Token de acceso firmado con expiración corta (`sc2.<payload>.<sig>`). */
  accessToken: string;
  /** Token de renovación rotativo de larga duración (`scr1.<sessionId>.<secret>`). */
  refreshToken: string;
  /** Timestamp Epoch en segundos cuando expirará el `accessToken`. */
  accessTokenExpiresAt: number;
  /** Timestamp Epoch en segundos cuando expirará el `refreshToken`. */
  refreshTokenExpiresAt: number;
  /** Identificador de usuario titular de la sesión. */
  userId: string;
  /** Identificador de usuario del host propietario de la nube. */
  hostUserId: string;
}

/**
 * Calcula el hash criptográfico SHA-256 de un refresh token en formato hexadecimal.
 *
 * El token original nunca se almacena en texto plano en la base de datos; solo
 * se persiste su digest criptográfico para prevenir riesgos de divulgación.
 *
 * @param refreshToken - Cadena en texto plano del refresh token a hashear.
 * @returns Digest SHA-256 codificado en hexadecimal en minúsculas.
 */
export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

/**
 * Valida la sintaxis de un token de renovación y extrae sus componentes (`sessionId` y `secret`).
 *
 * Aplica comprobaciones previas de longitud y prefijo de alta velocidad (fast-path)
 * antes de evaluar la expresión regular precompilada, minimizando la sobrecarga de CPU.
 *
 * @param refreshToken - Cadena de texto del token de renovación recibido.
 * @returns Objeto con `sessionId` y `secret` si el formato es válido, o `null` si es ilegible o malicioso.
 */
export function parseRefreshToken(refreshToken: string): { sessionId: string; secret: string } | null {
  if (typeof refreshToken !== "string") {
    return null;
  }

  const trimmed = refreshToken.trim();
  if (trimmed.length < MIN_REFRESH_TOKEN_LENGTH || !trimmed.startsWith(REFRESH_TOKEN_PREFIX)) {
    return null;
  }

  const match = REFRESH_TOKEN_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1]!,
    secret: match[2]!,
  };
}

/**
 * Realiza una comparación en tiempo constante (constant-time) entre dos digests hexadecimales SHA-256.
 *
 * Protege contra ataques de canal lateral de temporización (timing attacks).
 * Si las longitudes difieren o no corresponden exactamente a un digest SHA-256 (64 hex chars),
 * descarta la comparación de inmediato sin asignar búferes en memoria.
 *
 * @param leftHex - Primer hash en formato hexadecimal a comparar.
 * @param rightHex - Segundo hash en formato hexadecimal a comparar.
 * @returns `true` si ambos hashes son válidos e idénticos byte a byte; de lo contrario `false`.
 */
export function secureHashEquals(leftHex: string, rightHex: string): boolean {
  if (leftHex.length !== SHA256_HEX_LENGTH || rightHex.length !== SHA256_HEX_LENGTH) {
    return false;
  }

  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");

  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Crea y persiste una nueva sesión de acceso revocable para un miembro invitado.
 *
 * Genera de forma atómica:
 * 1. Un identificador único de sesión UUID v4.
 * 2. Un secreto criptográfico seguro de 256 bits (`randomBytes(32)`).
 * 3. El registro inicial de la sesión en el repositorio con su hash SHA-256.
 * 4. El token de acceso firmado (`sc2`) correspondiente.
 *
 * @param repository - Repositorio de persistencia de sesiones de acceso (`AccessSessionRepository`).
 * @param userId - Identificador de usuario del miembro autenticado.
 * @param hostUserId - Identificador del host propietario de la nube de guardados.
 * @returns Tokens de acceso y renovación generados junto a sus marcas temporales de expiración.
 */
export async function createAccessSession(
  repository: AccessSessionRepository,
  userId: string,
  hostUserId: string
): Promise<AccessSessionTokens> {
  const normalizedUserId = userId.trim();
  const normalizedHostUserId = hostUserId.trim();
  const now = Math.floor(Date.now() / 1000);

  const sessionId = randomUUID();
  const refreshSecret = randomBytes(32).toString("base64url");
  const refreshToken = `${REFRESH_TOKEN_PREFIX}${sessionId}.${refreshSecret}`;
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshTokenExpiresAt = now + REFRESH_SESSION_TTL_SECONDS;
  const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;

  // Persistir la sesión en la base de datos
  await repository.create({
    sessionId,
    userId: normalizedUserId,
    hostUserId: normalizedHostUserId,
    refreshTokenHash,
    active: true,
    createdAt: new Date(now * 1000).toISOString(),
    expiresAtEpoch: refreshTokenExpiresAt,
  });

  const accessToken = issueUserAccessToken(normalizedUserId, sessionId, normalizedHostUserId, ACCESS_TOKEN_TTL_SECONDS);

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    userId: normalizedUserId,
    hostUserId: normalizedHostUserId,
  };
}

/**
 * Rota atómicamente un refresh token según la especificación RFC 6749 (Refresh Token Rotation).
 *
 * Optimizaciones de rendimiento aplicadas:
 * - Solapamiento de cómputo criptográfico SHA-256 con la consulta a la base de datos.
 * - Ejecución concurrente (`Promise.all`) de la verificación de autorización (`authorize`)
 *   y la rotación condicional en DynamoDB (`repository.rotateRefreshToken`), reduciendo
 *   la latencia total en un roundtrip completo de red I/O.
 * - Detección y defensa automática contra reutilización de tokens (Reuse Detection): si el hash
 *   del token no coincide con el último emitido, asume compromiso de seguridad y revoca la sesión.
 *
 * @param repository - Repositorio de sesiones de acceso.
 * @param refreshToken - Token de renovación actual enviado por el cliente.
 * @param authorize - Callback asíncrono opcional para validar la vigencia de la membresía en la nube.
 * @returns Nuevos tokens de acceso y renovación emitidos, o `null` si la sesión expiró, fue revocada o es inválida.
 */
export async function rotateAccessSession(
  repository: AccessSessionRepository,
  refreshToken: string,
  authorize?: (session: { userId: string; hostUserId: string }) => Promise<boolean>
): Promise<AccessSessionTokens | null> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) {
    return null;
  }

  const sessionPromise = repository.get(parsed.sessionId);
  const currentHash = hashRefreshToken(refreshToken.trim());
  const session = await sessionPromise;

  const now = Math.floor(Date.now() / 1000);

  if (!session || !session.active || session.expiresAtEpoch <= now) {
    return null;
  }

  if (!secureHashEquals(session.refreshTokenHash, currentHash)) {
    await repository.revoke(session.sessionId);
    return null;
  }

  const nextSecret = randomBytes(32).toString("base64url");
  const nextRefreshToken = `${REFRESH_TOKEN_PREFIX}${session.sessionId}.${nextSecret}`;
  const nextHash = hashRefreshToken(nextRefreshToken);
  const nextRefreshExpiresAt = now + REFRESH_SESSION_TTL_SECONDS;

  const [isAuthorized, rotated] = await Promise.all([
    authorize ? authorize(session) : Promise.resolve(true),
    repository.rotateRefreshToken(session.sessionId, session.refreshTokenHash, nextHash, nextRefreshExpiresAt),
  ]);

  if (!isAuthorized) {
    await repository.revoke(session.sessionId);
    return null;
  }

  if (!rotated) {
    return null;
  }

  const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  const accessToken = issueUserAccessToken(
    session.userId,
    session.sessionId,
    session.hostUserId,
    ACCESS_TOKEN_TTL_SECONDS
  );

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: nextRefreshExpiresAt,
    userId: session.userId,
    hostUserId: session.hostUserId,
  };
}
