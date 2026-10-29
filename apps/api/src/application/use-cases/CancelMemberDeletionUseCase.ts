import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

export interface CancelMemberDeletionInput {
  /** userId del solicitante; debe coincidir con hostUserId. */
  requesterId: string;
  /** Dueño de la nube. */
  hostUserId: string;
  /** Miembro cuya eliminación se cancela. */
  memberUserId: string;
}

/**
 * Cancela la eliminación programada de un miembro durante el grace period.
 *
 * Solo puede ejecutarlo el host. Si el grace period ya expiró (o la
 * purga ya fue ejecutada por el worker), devuelve GONE.
 */
export class CancelMemberDeletionUseCase {
  constructor(
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly webSocketNotifier?: WebSocketNotifier,
    private readonly connectionRepository?: ConnectionRepository
  ) {}

  async execute(input: CancelMemberDeletionInput): Promise<void> {
    const hostUserId = input.hostUserId.trim();
    const memberUserId = input.memberUserId.trim();
    const requesterId = input.requesterId.trim();

    if (requesterId !== hostUserId) {
      throw new ApplicationError("FORBIDDEN", "Solo el anfitrión puede cancelar la eliminación de un miembro.");
    }

    const membership = await this.cloudInviteRepository.getMembership(hostUserId, memberUserId);
    if (!membership) {
      throw new ApplicationError("NOT_FOUND", "No se encontró una membresía entre el anfitrión y el miembro.");
    }

    if (!membership.scheduledDeletionAt) {
      throw new ApplicationError("CONFLICT", "Este miembro no tiene ninguna eliminación programada.");
    }

    // Verificar que el grace period no expiró (la purga todavía no debería haber corrido)
    if (membership.scheduledDeletionAt <= new Date().toISOString()) {
      throw new ApplicationError(
        "GONE",
        "El período de gracia ya expiró. Los datos del miembro han sido o están siendo eliminados."
      );
    }

    // Restaurar membresía: active: true, limpiar scheduledDeletionAt/By
    await this.cloudInviteRepository.cancelScheduledMemberDeletion(hostUserId, memberUserId);

    // Notificar al miembro que fue reintegrado vía WebSocket (no crítico)
    if (this.webSocketNotifier && this.connectionRepository) {
      const connectionIds = await this.connectionRepository.getConnectionsByUser(memberUserId).catch(() => []);
      const payload = { type: "MEMBER_REMOVAL_CANCELLED", data: { hostUserId } };
      for (const connectionId of connectionIds) {
        this.webSocketNotifier.sendToConnection(connectionId, payload).catch((err: unknown) => {
          console.warn(`[CancelMemberDeletionUseCase] No se pudo notificar al miembro (${connectionId}):`, err);
        });
      }
    }
  }
}
