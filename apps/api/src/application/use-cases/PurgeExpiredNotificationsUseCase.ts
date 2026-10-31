import type { ExpiredNotificationRepository } from "@domain/ports/ExpiredNotificationRepository";

const DEFAULT_BATCH_SIZE = 1_000;

/** Elimina en lotes todos los registros de notificaciones cuya retención haya vencido. */
export class PurgeExpiredNotificationsUseCase {
  /** Crea el caso de uso con el puerto de mantenimiento de notificaciones. */
  constructor(private readonly repository: ExpiredNotificationRepository) {}

  /**
   * Repite la eliminación por lotes hasta que no quede otro lote completo.
   * @param batchSize Número máximo de registros que cada operación puede borrar.
   * @returns Total de registros eliminados durante la ejecución.
   */
  async execute(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    let totalDeleted = 0;
    let deletedInBatch: number;

    do {
      deletedInBatch = await this.repository.deleteExpiredBatch(batchSize);
      totalDeleted += deletedInBatch;
    } while (deletedInBatch === batchSize);

    return totalDeleted;
  }
}
