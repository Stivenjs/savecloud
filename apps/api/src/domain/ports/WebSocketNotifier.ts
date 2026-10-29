/**
 * @interface WebSocketNotifier
 * @description Envía mensajes ("pushes") directamente a los clientes de escritorio.
 */
export interface WebSocketNotifier {
  /**
   * Envía un JSON al socket especificado.
   * @param {string} connectionId - ID del socket destino.
   * @param {any} payload - El cuerpo de la notificación.
   */
  sendToConnection(connectionId: string, payload: any): Promise<void>;

  /** Cierra todas las conexiones activas de un usuario al revocar su membresía. */
  disconnectUser?(userId: string): Promise<void>;
}
