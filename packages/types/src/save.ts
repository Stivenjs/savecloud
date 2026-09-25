/**
 * Representa un archivo de guardado individual en la nube (S3).
 */
export interface GameSave {
  /** Identificador del juego (ej. "cyberpunk-2077") */
  gameId: string;
  /** Clave completa del objeto en S3 (ej. "user123/gameId/folder/save.dat") */
  key: string;
  /**
   * Ruta relativa del archivo dentro de la carpeta del juego.
   * Utilizado para reconstruir la ruta local en el cliente.
   */
  filename: string;
  /** Fecha de la última modificación en el servidor */
  lastModified: Date;
  /** Tamaño del archivo en bytes (opcional) */
  size?: number;
}
