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
    if (input.token !== undefined && !/^[a-f0-9]{48}$/.test(input.token)) {
      throw new ApplicationError("INVALID_ARGUMENT", "El código de invitación no es válido.");
    }
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

    if (input.action === "accept") {
      const invitedUserId = invite.inviteeUserId?.trim();
      if (invitedUserId && invitedUserId !== userId) {
        throw new ApplicationError("FORBIDDEN", "La invitación no pertenece a este usuario.");
      }

      const existingMembership = await this.repository.getMembership(invite.hostUserId, userId);
      if (existingMembership?.active) {
        throw new ApplicationError("CONFLICT", "Este ID ya pertenece a un miembro activo de esta nube.");
      }

      const now = new Date().toISOString();
      invite.status = "accepted";
      invite.acceptedAt = now;
      invite.updatedAt = now;
      invite.inviteeUserId = invitedUserId || userId;
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

    if (invite.inviteeUserId?.trim() && invite.inviteeUserId.trim() !== userId) {
      throw new ApplicationError("FORBIDDEN", "La invitación no pertenece a este usuario.");
    }
    const now = new Date().toISOString();
    invite.status = "rejected";
    invite.rejectedAt = now;
    invite.updatedAt = now;
    await this.repository.updateInvite(invite);

    return invite;
  }
}
