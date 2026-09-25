/**
 * Representa la configuración y metadatos de un juego gestionado por SaveCloud.
 */
export interface ConfiguredGame {
  readonly id: string;
  readonly paths: readonly string[];
  /** Steam App ID: si está definido, se usa la imagen del CDN de Steam. */
  readonly steamAppId?: string;
  /** URL personalizada de imagen. Prioridad sobre steamAppId. Para juegos no-Steam. */
  readonly imageUrl?: string;
  /** Nombres de ejecutable para detectar si el juego está en ejecución (ej. ["eldenring.exe"]). */
  readonly executableNames?: readonly string[];
  /** Ruta absoluta al recurso para abrir el juego desde la app (.exe, .jar, script, etc.). */
  readonly launchExecutablePath?: string;
  /** Etiqueta de origen/edición (ej. Steam, Empress, RUNE). Solo informativa. */
  readonly editionLabel?: string;
  /** URL de descarga o página de la edición (ej. enlace al release). */
  readonly sourceUrl?: string;
  /** Magnet link o ruta a archivo .torrent para descargar contenido. */
  readonly magnetLink?: string;
}
