import type { CloudInvite } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";

export class ListPendingCloudInvitesUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(userId: string): Promise<CloudInvite[]> {
    return this.repository.listPendingInvitesForUser(userId);
  }
}
