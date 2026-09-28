import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { CloudInvite } from "@domain/entities/CloudInvite";
import { ApplicationError } from "@application/errors/ApplicationError";

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
    if (!invite) throw new ApplicationError("NOT_FOUND", "No se encontró la invitación.");
    if (invite.status !== "pending") throw new ApplicationError("CONFLICT", "La invitación ya no está pendiente.");
    if (invite.expiresAt <= new Date().toISOString()) throw new ApplicationError("GONE", "La invitación expiró.");
    if (invite.hostUserId.trim() === userId) {
      throw new ApplicationError("FORBIDDEN", "No puedes aceptar tu propia invitación.");
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
        throw new ApplicationError("FORBIDDEN", "La invitación no pertenece a este usuario.");
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
      throw new ApplicationError("FORBIDDEN", "La invitación no pertenece a este usuario.");
    }
    invite.status = "rejected";
    invite.rejectedAt = now;
    invite.updatedAt = now;
    await this.repository.updateInvite(invite);

    return invite;
  }
}
