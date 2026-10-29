import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

/** Días de gracia por defecto antes de que se ejecute la purga real. */
const DEFAULT_GRACE_PERIOD_DAYS = 30;

export interface RemoveMemberInput {
  /** userId del solicitante; debe coincidir con hostUserId. */
  requesterId: string;
  /** Dueño de la nube. */
  hostUserId: string;
  /** Miembro a remover. */
  memberUserId: string;
  /**
   * Días de gracia antes de la purga definitiva.
   * Si no se indica, toma `MEMBER_DELETION_GRACE_DAYS` del entorno (default 30).
   */
  gracePeriodDays?: number;
}

export interface RemoveMemberOutput {
  /** ISO timestamp en el que se ejecutará la purga real de datos. */
  scheduledDeletionAt: string;
}

/**
 * Elimina a un miembro de una nube con un período de gracia (soft delete).
 *
 * La membresía se marca como inactiva de inmediato y se programa la purga
 * real (archivos S3 + ACLs + registro MEMBERSHIP en DynamoDB) para cuando
 * expire el grace period. Durante ese período el host puede cancelar.
 */
export class RemoveMemberUseCase {
  constructor(
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly accessSessionRepository?: AccessSessionRepository,
    private readonly webSocketNotifier?: WebSocketNotifier,
    private readonly connectionRepository?: ConnectionRepository
  ) {}

  async execute(input: RemoveMemberInput): Promise<RemoveMemberOutput> {
    const hostUserId = input.hostUserId.trim();
    const memberUserId = input.memberUserId.trim();
    const requesterId = input.requesterId.trim();

    if (requesterId !== hostUserId) {
      throw new ApplicationError("FORBIDDEN", "Solo el anfitrión puede remover miembros de su nube.");
    }

    if (hostUserId === memberUserId) {
      throw new ApplicationError("INVALID_ARGUMENT", "El anfitrión no puede removerse a sí mismo.");
    }

    const membership = await this.cloudInviteRepository.getMembership(hostUserId, memberUserId);
    if (!membership) {
      throw new ApplicationError("NOT_FOUND", "No se encontró una membresía entre el anfitrión y el miembro.");
    }
    if (!membership.active && membership.scheduledDeletionAt) {
      throw new ApplicationError("CONFLICT", "Este miembro ya tiene una eliminación programada.");
    }
    if (!membership.active) {
      throw new ApplicationError("CONFLICT", "La membresía ya está inactiva.");
    }

    const graceDays =
      input.gracePeriodDays ??
      (process.env.MEMBER_DELETION_GRACE_DAYS
        ? Number(process.env.MEMBER_DELETION_GRACE_DAYS)
        : DEFAULT_GRACE_PERIOD_DAYS);

    if (!Number.isFinite(graceDays) || graceDays < 1) {
      throw new ApplicationError("INVALID_ARGUMENT", "El período de gracia debe ser al menos 1 día.");
    }

    const scheduledDeletionAt = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();

    await this.cloudInviteRepository.scheduleMemberDeletion(hostUserId, memberUserId, scheduledDeletionAt, hostUserId);

    await this.accessSessionRepository?.revokeMembershipSessions(hostUserId, memberUserId);

    await this.webSocketNotifier?.disconnectUser?.(memberUserId);
    if (this.webSocketNotifier && this.connectionRepository) {
      const connectionIds = await this.connectionRepository.getConnectionsByUser(memberUserId).catch(() => []);
      const payload = {
        type: "MEMBER_REMOVED",
        data: { hostUserId, scheduledDeletionAt },
      };
      for (const connectionId of connectionIds) {
        this.webSocketNotifier.sendToConnection(connectionId, payload).catch((err: unknown) => {
          console.warn(`[RemoveMemberUseCase] No se pudo notificar al miembro (${connectionId}):`, err);
        });
      }
    }

    return { scheduledDeletionAt };
  }
}
