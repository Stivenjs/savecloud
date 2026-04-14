import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { CloudInvite } from "@domain/entities/CloudInvite";

export interface RespondCloudInviteInput {
  userId: string;
  inviteId?: string;
  token?: string;
  action: "accept" | "reject";
}

export class RespondCloudInviteUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(input: RespondCloudInviteInput): Promise<CloudInvite> {
    const userId = input.userId.trim();
    const invite = input.inviteId
      ? await this.repository.getInviteById(input.inviteId)
      : input.token
        ? await this.repository.getInviteByToken(input.token)
        : null;
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "pending") throw new Error("Invite is no longer pending");
    if (invite.expiresAt <= new Date().toISOString()) throw new Error("Invite expired");
    if (invite.hostUserId.trim() === userId) {
      throw new Error("You cannot accept your own invite");
    }

    const now = new Date().toISOString();
    if (input.action === "accept") {
      invite.status = "accepted";
      invite.acceptedAt = now;
      invite.updatedAt = now;
      if (!invite.inviteeUserId) {
        invite.inviteeUserId = userId;
      }
      if (invite.inviteeUserId !== userId) {
        throw new Error("Invite does not belong to this user");
      }
      await this.repository.updateInvite(invite);
      await this.repository.upsertMembership({
        hostUserId: invite.hostUserId,
        memberUserId: invite.inviteeUserId,
        invitedById: invite.id,
        wsUrl: invite.wsUrl,
        createdAt: now,
        updatedAt: now,
        active: true,
      });
      return invite;
    }

    if (invite.inviteeUserId && invite.inviteeUserId !== input.userId.trim()) {
      throw new Error("Invite does not belong to this user");
    }
    invite.status = "rejected";
    invite.rejectedAt = now;
    invite.updatedAt = now;
    await this.repository.updateInvite(invite);

    return invite;
  }
}
