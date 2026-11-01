import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { CloudInvite } from "@domain/entities/CloudInvite";
import { ApplicationError } from "@application/errors/ApplicationError";

/** Datos necesarios para aceptar o rechazar una invitación a una nube compartida. */
export interface RespondCloudInviteInput {
  /** Identificador del usuario que responde la invitación. */
  userId: string;
  /** Identificador de la invitación; se usa cuando la respuesta no se hace con token. */
  inviteId?: string;
  /** Token hexadecimal de invitación para aceptar mediante el flujo bootstrap. */
  token?: string;
  /** Acción solicitada para la invitación. */
  action: "accept" | "reject";
}

/**
 * Coordina la aceptación o el rechazo de invitaciones a nubes compartidas.
 *
 */
export class RespondCloudInviteUseCase {
  /**
   * @param repository - Repositorio que consulta invitaciones y membresías y persiste sus cambios.
   */
  constructor(private readonly repository: CloudInviteRepository) {}

  /**
   * Responde una invitación y valida que el usuario pueda realizar la acción solicitada.
   * Si el usuario ya es miembro activo, solo permite recuperar el acceso con una invitación
   * dirigida a su identificador; conserva intacta la membresía existente.
   *
   * @param input - Usuario, identificador o token de invitación y acción solicitada.
   * @returns La invitación actualizada tras aceptar o rechazarla.
   * @throws {ApplicationError} Si la invitación no existe, expiró o el usuario no puede responderla.
   */
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
      const alreadyActiveMember = existingMembership?.active === true;
      if (alreadyActiveMember && invitedUserId !== userId) {
        throw new ApplicationError(
          "CONFLICT",
          "Ya eres miembro activo. Para recuperar el acceso, pide al anfitrión una invitación dirigida a tu usuario."
        );
      }

      const now = new Date().toISOString();
      invite.status = "accepted";
      invite.acceptedAt = now;
      invite.updatedAt = now;
      invite.inviteeUserId = invitedUserId || userId;
      await this.repository.updateInvite(invite);

      if (!alreadyActiveMember) {
        await this.repository.upsertMembership({
          hostUserId: invite.hostUserId,
          memberUserId: invite.inviteeUserId,
          invitedById: invite.id,
          wsUrl: invite.wsUrl,
          createdAt: existingMembership?.createdAt ?? now,
          updatedAt: now,
          active: true,
          scheduledDeletionAt: null,
          scheduledDeletionBy: null,
        });
      }
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
