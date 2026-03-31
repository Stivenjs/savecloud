import type { CloudInvite } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";

export interface CreateCloudInviteInput {
  hostUserId: string;
  inviteeUserId?: string;
  expiresInDays?: number;
  withToken?: boolean;
}

export class CreateCloudInviteUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(input: CreateCloudInviteInput): Promise<CloudInvite> {
    const host = input.hostUserId.trim();
    const invitee = input.inviteeUserId?.trim();
    if (invitee && invitee === host) {
      throw new Error("You cannot invite yourself");
    }

    // Política actual: invitaciones cloud expiran y se purgan a los 7 días.
    const ttlDays = Math.max(1, Math.min(input.expiresInDays ?? 7, 7));
    return this.repository.createInvite({
      hostUserId: host,
      inviteeUserId: invitee || undefined,
      ttlSeconds: ttlDays * 24 * 60 * 60,
      withToken: input.withToken ?? true,
    });
  }
}
