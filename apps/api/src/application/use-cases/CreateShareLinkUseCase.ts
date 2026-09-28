import type { ShareTokenRepository } from "@domain/ports/ShareTokenRepository";

const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export class CreateShareLinkUseCase {
  constructor(private readonly shareTokenRepository: ShareTokenRepository) {}

  async execute(input: { userId: string; gameId: string; expiresInDays?: number }): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const ttlSeconds =
      typeof input.expiresInDays === "number" && input.expiresInDays > 0
        ? Math.min(Math.floor(input.expiresInDays * 24 * 60 * 60), MAX_TTL_SECONDS)
        : DEFAULT_TTL_SECONDS;
    return this.shareTokenRepository.createToken(input.userId, input.gameId, ttlSeconds);
  }
}
