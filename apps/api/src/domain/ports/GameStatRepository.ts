import type { GameStat } from "@domain/entities/GameStat";

/**
 * Puerto (interface) para persistencia de estadísticas de juegos (Summary).
 * La capa de aplicación depende de este contrato para no acoplarse a una base de datos específica (DynamoDB).
 */
export interface GameStatRepository {
  /**
   * Obtiene la lista completa de estadísticas de juegos de un usuario específico.
   * Retorna una consulta ultra rápida de O(1) partición, reemplazando el escaneo masivo de S3.
   *
   * @param userId - Identificador del usuario o scope (ej. `host::member::guest`).
   */
  listByUser(userId: string): Promise<GameStat[]>;

  /**
   * Actualiza o inserta (Upsert) las estadísticas consolidadas de un juego.
   * Si las estadísticas ya existen, se sobrescriben con los valores totales precisos.
   *
   * @param stat - Objeto GameStat con las métricas recalculadas.
   */
  save(stat: GameStat): Promise<void>;

  /**
   * Elimina completamente el registro de estadísiticas de un juego en la base de datos.
   * Se invoca cuando el usuario borra por completo el juego de su nube.
   *
   * @param userId - Identificador del usuario.
   * @param gameId - Identificador del juego.
   */
  delete(userId: string, gameId: string): Promise<void>;
}
