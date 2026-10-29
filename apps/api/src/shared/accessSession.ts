import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import { issueUserAccessToken } from "@shared/accessToken";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessSessionTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  userId: string;
  hostUserId: string;
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function parseRefreshToken(refreshToken: string): { sessionId: string; secret: string } | null {
  const match = /^scr1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/.exec(refreshToken.trim());
  return match ? { sessionId: match[1]!, secret: match[2]! } : null;
}

export function secureHashEquals(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function createAccessSession(
  repository: AccessSessionRepository,
  userId: string,
  hostUserId: string
): Promise<AccessSessionTokens> {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomUUID();
  const refreshSecret = randomBytes(32).toString("base64url");
  const refreshToken = `scr1.${sessionId}.${refreshSecret}`;
  const refreshTokenExpiresAt = now + REFRESH_SESSION_TTL_SECONDS;
  await repository.create({
    sessionId,
    userId: userId.trim(),
    hostUserId: hostUserId.trim(),
    refreshTokenHash: hashRefreshToken(refreshToken),
    active: true,
    createdAt: new Date(now * 1000).toISOString(),
    expiresAtEpoch: refreshTokenExpiresAt,
  });

  const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  return {
    accessToken: issueUserAccessToken(userId, sessionId, hostUserId, ACCESS_TOKEN_TTL_SECONDS),
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    userId: userId.trim(),
    hostUserId: hostUserId.trim(),
  };
}

export async function rotateAccessSession(
  repository: AccessSessionRepository,
  refreshToken: string,
  authorize?: (session: { userId: string; hostUserId: string }) => Promise<boolean>
): Promise<AccessSessionTokens | null> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return null;

  const session = await repository.get(parsed.sessionId);
  if (!session || !session.active || session.expiresAtEpoch <= Math.floor(Date.now() / 1000)) return null;
  const currentHash = hashRefreshToken(refreshToken);
  if (!secureHashEquals(session.refreshTokenHash, currentHash)) {
    await repository.revoke(session.sessionId);
    return null;
  }
  if (authorize && !(await authorize(session))) {
    await repository.revoke(session.sessionId);
    return null;
  }

  const nextSecret = randomBytes(32).toString("base64url");
  const nextRefreshToken = `scr1.${session.sessionId}.${nextSecret}`;
  const nextHash = hashRefreshToken(nextRefreshToken);
  const nextRefreshExpiresAt = Math.floor(Date.now() / 1000) + REFRESH_SESSION_TTL_SECONDS;
  const rotated = await repository.rotateRefreshToken(
    session.sessionId,
    session.refreshTokenHash,
    nextHash,
    nextRefreshExpiresAt
  );
  if (!rotated) return null;

  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  return {
    accessToken: issueUserAccessToken(session.userId, session.sessionId, session.hostUserId, ACCESS_TOKEN_TTL_SECONDS),
    refreshToken: nextRefreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: nextRefreshExpiresAt,
    userId: session.userId,
    hostUserId: session.hostUserId,
  };
}
