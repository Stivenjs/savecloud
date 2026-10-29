export interface AccessSession {
  sessionId: string;
  userId: string;
  hostUserId: string;
  refreshTokenHash: string;
  active: boolean;
  createdAt: string;
  expiresAtEpoch: number;
}
