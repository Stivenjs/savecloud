/**
 * Carpeta candidata a ser una ruta de guardados de juego.
 * Resultado del análisis de rutas típicas (Documents/My Games, AppData, etc.).
 */
export interface PathCandidate {
  /** Ruta absoluta a la carpeta */
  readonly path: string;
  /** Nombre de la carpeta (para mostrar al usuario) */
  readonly folderName: string;
  /** Ruta base desde la que se escaneó (ej. Documents/My Games) */
  readonly basePath: string;
}
