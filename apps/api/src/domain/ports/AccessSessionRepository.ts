import type { AccessSession } from "@domain/entities/AccessSession";

export interface AccessSessionRepository {
  create(session: AccessSession): Promise<void>;
  get(sessionId: string): Promise<AccessSession | null>;
  rotateRefreshToken(
    sessionId: string,
    expectedTokenHash: string,
    nextTokenHash: string,
    expiresAtEpoch: number
  ): Promise<boolean>;
  revoke(sessionId: string): Promise<void>;
  revokeMembershipSessions(hostUserId: string, userId: string): Promise<void>;
}
