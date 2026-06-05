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
  saveConnection(connectionId: string, userId: string, ttl: number, deviceId?: string): Promise<void>;

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

  /**
   * Obtiene las conexiones activas de un usuario en un dispositivo específico.
   * @param {string} userId - ID del usuario.
   * @param {string} deviceId - ID del dispositivo.
   * @returns {Promise<string[]>} Lista de IDs de conexión.
   */
  getConnectionsByUserAndDevice(userId: string, deviceId: string): Promise<string[]>;

  /**
   * Obtiene los metadatos de actividad para cada conexión activa de un usuario.
   */
  getConnectionPresenceByUser(userId: string): Promise<
    Array<{
      connectionId: string;
      lastActivityAt: number | null;
      activityGameId: string | null;
      activityGameName: string | null;
    }>
  >;

  /**
   * Lookup inverso: dado un connectionId, devuelve el userId verificado.
   */
  getUserByConnection(connectionId: string): Promise<string | null>;

  /**
   * Actualiza la actividad de una conexión (heartbeat/juego activo).
   */
  setConnectionActivity(
    connectionId: string,
    input: {
      lastActivityAt: number;
      activityGameId?: string | null;
      activityGameName?: string | null;
    }
  ): Promise<void>;
}
