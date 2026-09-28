import type { GetTokenResult } from "@domain/entities/ShareToken";

/** Define las operaciones de persistencia de enlaces compartidos. */
export interface ShareTokenRepository {
  createToken(userId: string, gameId: string, ttlSeconds?: number): Promise<{ token: string; expiresAt: string }>;
  getToken(token: string): Promise<GetTokenResult>;
}
