import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface PurgeSoftDeletedMembersOutput {
  /** Número de membresías purgadas exitosamente. */
  purged: number;
  /** Errores individuales que no abortaron el resto de la purga. */
  errors: Array<{ hostUserId: string; memberUserId: string; error: string }>;
}

/**
 * Limpia físicamente los datos de los miembros cuyo grace period ya expiró.
 *
 * Para cada membresía con `scheduledDeletionAt <= now`:
 *  1. Borra todos los archivos S3 del miembro (`userId/` prefix completo).
 *  2. Borra todos los registros GAME_SHARE en DynamoDB para ese par host/member.
 *  3. Elimina la entrada MEMBERSHIP de DynamoDB.
 *
 * Cada membresía se procesa de forma independiente: si una falla, el resto
 * continúa y el worker volverá a intentarla en el siguiente ciclo.
 *
 * @remarks
 * Solo debe invocarse desde el worker de purga (member-purge-worker.ts),
 * nunca desde rutas HTTP. Es una operación irreversible.
 */
export class PurgeSoftDeletedMembersUseCase {
  constructor(
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly saveRepository: SaveRepository
  ) {}

  async execute(): Promise<PurgeSoftDeletedMembersOutput> {
    const now = new Date().toISOString();
    const memberships = await this.cloudInviteRepository.listMembershipsReadyForPurge(now);

    let purged = 0;
    const errors: PurgeSoftDeletedMembersOutput["errors"] = [];

    for (const membership of memberships) {
      const { hostUserId, memberUserId } = membership;
      try {
        const scopedMemberStorageId = `${hostUserId}::member::${memberUserId}`;
        await this.saveRepository.deleteAllForUser(scopedMemberStorageId);

        await this.cloudInviteRepository.deleteAllGameSharesForMember(hostUserId, memberUserId);

        await this.cloudInviteRepository.deleteMembershipRecord(hostUserId, memberUserId);

        purged++;
        console.info(`[PurgeSoftDeletedMembersUseCase] Purgado: host=${hostUserId} member=${memberUserId}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ hostUserId, memberUserId, error: message });
        console.error(
          `[PurgeSoftDeletedMembersUseCase] Error al purgar host=${hostUserId} member=${memberUserId}:`,
          err
        );
      }
    }

    return { purged, errors };
  }
}
