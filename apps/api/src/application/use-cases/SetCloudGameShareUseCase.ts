import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

export class SetCloudGameShareUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(input: { hostUserId: string; memberUserId: string; gameId: string; shared: boolean }): Promise<void> {
    const membership = await this.repository.getMembership(input.hostUserId, input.memberUserId);
    if (!membership || !membership.active) {
      throw new ApplicationError("FORBIDDEN", "El miembro no está activo en esta nube.");
    }
    await this.repository.setGameShared(input.hostUserId, input.memberUserId, input.gameId, input.shared);
  }
}
