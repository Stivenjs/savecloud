/**
 * @interface ConnectionRepository
 * @description Maneja los identificadores de red de los usuarios conectados actualmente.
 */
export interface ConnectionRepository {
  /**
   * Guarda una conexión activa.
   * @param {string} connectionId - ID del socket en AWS.
   * @param {string} userId - ID del usuario.
   * @param {number} ttl - Timestamp Unix de expiración (24h).
   */
  saveConnection(connectionId: string, userId: string, ttl: number): Promise<void>;

  /**
   * Elimina una conexión cuando el usuario cierra la app.
   * @param {string} connectionId - ID del socket en AWS.
   */
  deleteConnection(connectionId: string): Promise<void>;

  /**
   * Obtiene las conexiones activas de un usuario para poder enviarle mensajes.
   * @param {string} userId - ID del usuario.
   * @returns {Promise<string[]>} Lista de IDs de conexión.
   */
  getConnectionsByUser(userId: string): Promise<string[]>;
}
