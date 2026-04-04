/**
 * Representa un archivo de guardado individual en la nube.
 */
export interface GameSave {
  /** Identificador del juego (ej. "cyberpunk-2077") */
  gameId: string;
  /** Clave completa del objeto en S3 (ej. "user123/gameId/folder/save.dat") */
  key: string;
  /** * Ruta relativa del archivo dentro de la carpeta del juego.
   * Es vital para que el cliente Rust reconstruya la ruta local.
   */
  filename: string;
  /** Fecha de la última modificación en el servidor */
  lastModified: Date;
  /** Tamaño del archivo en bytes (opcional) */
  size?: number;
}
