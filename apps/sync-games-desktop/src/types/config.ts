/**
 * Tipos compartidos para la configuración de sync-games.
 * Deben coincidir con el formato del CLI.
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
  /** Magnet link o ruta a archivo .torrent para descargar contenido. */
  readonly magnetLink?: string;
}

export interface Config {
  readonly apiBaseUrl?: string;
  readonly apiKey?: string;
  readonly userId?: string;
  readonly games: readonly ConfiguredGame[];
  readonly customScanPaths?: readonly string[];
  /** Cuántos backups locales mantener por juego (valor por defecto del selector y auto-limpieza tras descargas). */
  readonly keepBackupsPerGame?: number;
  /** Experimental: backup completo (tar) en streaming, sin .tar temporal. */
  readonly fullBackupStreaming?: boolean;
  /** Modo prueba: streaming sin subir a la nube. */
  readonly fullBackupStreamingDryRun?: boolean;
}
