/**
 * Representa las estadísticas agregadas de guardados para un juego específico de un usuario.
 */
export interface GameStat {
  /** Identificador del propietario (o del scope compartido `host::member::guest`). */
  userId: string;
  /** Identificador del juego (ej. steam_app_12345). */
  gameId: string;
  /** Cantidad total de archivos de guardado almacenados para este juego en S3. */
  fileCount: number;
  /** Suma total del tamaño en bytes de todos los archivos del juego. */
  totalSizeBytes: number;
  /** Fecha de la última modificación del archivo más reciente, o null si no hay archivos. */
  lastModified: Date | null;
}
