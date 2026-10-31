/** Contrato de persistencia para el mantenimiento de expiración de notificaciones. */
export interface ExpiredNotificationRepository {
  /** Elimina como máximo `limit` registros vencidos y devuelve el número eliminado. */
  deleteExpiredBatch(limit: number): Promise<number>;
}
