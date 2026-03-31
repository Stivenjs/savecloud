import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";

export class SetCloudGameShareUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(input: { hostUserId: string; memberUserId: string; gameId: string; shared: boolean }): Promise<void> {
    const membership = await this.repository.getMembership(input.hostUserId, input.memberUserId);
    if (!membership || !membership.active) {
      throw new Error("Member is not active in this host cloud");
    }
    await this.repository.setGameShared(input.hostUserId, input.memberUserId, input.gameId, input.shared);
  }
}
