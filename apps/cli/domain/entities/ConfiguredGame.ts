/**
 * Juego configurado en el CLI: identificador y rutas locales a guardados.
 * Las rutas pueden contener variables de entorno (ej. %APPDATA%, %USERPROFILE%).
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
  /** Etiqueta de origen/edición (ej. Steam, Empress, RUNE). Solo informativa. */
  readonly editionLabel?: string;
  /** URL de descarga o página de la edición (ej. enlace al release). */
  readonly sourceUrl?: string;
}
