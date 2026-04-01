/**
 * Tipos compartidos para la configuración de SaveCloud.
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
  /** Ruta absoluta al .exe para abrir el juego desde la app. */
  readonly launchExecutablePath?: string;
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
  /** Clave Steam Web API si está configurada; valor enmascarado desde el backend. */
  readonly steamWebApiKey?: string;
  readonly userId?: string;
  /** ID del usuario que está usando la nube como host. */
  readonly activeCloudHostUserId?: string;
  readonly games: readonly ConfiguredGame[];
  readonly customScanPaths?: readonly string[];
  /** Tiempo de juego total acumulado (segundos). */
  readonly totalPlaytime?: number;
  /** Cuántos backups locales mantener por juego (valor por defecto del selector y auto-limpieza tras descargas). */
  readonly keepBackupsPerGame?: number;
  /** Experimental: backup completo (tar) en streaming, sin .tar temporal. */
  readonly fullBackupStreaming?: boolean;
  /** Modo prueba: streaming sin subir a la nube. */
  readonly fullBackupStreamingDryRun?: boolean;
  /** Carpeta destino por defecto para descargas de fuentes JSON. */
  readonly defaultSourceDownloadDir?: string;
  /** URL o ruta local del fondo del perfil (imagen, GIF o vídeo). */
  readonly profileBackground?: string;
  /** URL, data URL o ruta local del avatar. */
  readonly profileAvatar?: string;
  /** URL o ruta local del marco sobre el avatar. */
  readonly profileFrame?: string;
  /** Si es true, los anfitriones de nubes donde participas pueden ver tu perfil visual al cargar tu usuario. */
  readonly shareVisualProfileWithHosts?: boolean;
}
