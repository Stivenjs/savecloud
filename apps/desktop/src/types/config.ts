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
  /** Ruta absoluta al recurso para abrir el juego desde la app (.exe, .jar, script, etc.). */
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
  readonly wsBaseUrl?: string;
  readonly apiKey?: string;
  /** Clave Steam Web API si está configurada; valor enmascarado desde el backend. */
  readonly steamWebApiKey?: string;
  readonly userId?: string;
  /** ID del usuario que está usando la nube como host. */
  readonly activeCloudHostUserId?: string;
  readonly cloudHostWsBaseUrls?: Record<string, string>;
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
  /**
   * Nivel Zstd (1–22) para backups completos empaquetados en modo streaming.
   * Si no está definido, la app usa el valor histórico por defecto (5).
   */
  readonly fullBackupPackagedCompressionLevel?: number | null;
  /** Tipo de layout del mando preferido para UI ("xbox" | "playstation" | "nintendo" | "generic"). */
  readonly preferredGamepadLayout?: string;
  /** Arranque de la ventana principal: ventana estándar o Big Picture (pantalla completa). */
  readonly startupWindowMode?: "normal" | "big_picture";
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
  /** Si es true, los miembros de tu nube pueden ver tu perfil visual al cargar tu usuario. */
  readonly shareVisualProfileWithMembers?: boolean;
  /** Si es true, compartes qué juegos tienes instalados con miembros del cloud (opt-out). */
  readonly shareGameInventoryWithCloud?: boolean;
  /** Modo juego activo en SaveCloud (mitigaciones conservadoras). */
  readonly gameModeEnabled?: boolean;
  /** Aplicar perfil de alto rendimiento (Windows powercfg Alto rendimiento, Linux performance, macOS caffeinate cuando hay soporte). */
  readonly gameModeApplyPowerProfile?: boolean;
  /** Solo Windows HKCU: desactivar captura de fondo tipo Game DVR donde sea posible. */
  readonly gameModeReduceCaptureOverhead?: boolean;
  /** Pausar subidas, torrents y descargas de fuentes gestionadas por SaveCloud. */
  readonly gameModeThrottleSavecloudBackground?: boolean;
  /**
   * Si la app detecta un juego de la biblioteca en ejecución, sube ligeramente la prioridad de CPU
   * de esos procesos (independiente del interruptor «Modo juego»).
   */
  readonly gameModeBoostDetectedGameCpu?: boolean;
  /** Por perfil: DevTools del webview y herramientas de plugins en la UI de producción. */
  readonly developerMode?: boolean;
  /** Dirección del proxy HTTP/HTTPS/SOCKS5 para enrutar descargas de hosters. */
  readonly proxyUrl?: string | null;
  /** Si es true, extrae automáticamente los juegos descargados al finalizar (ZIP, RAR, 7Z, TAR, etc.). */
  readonly autoExtractDownloads?: boolean;
  /** Modo bajo rendimiento para reducir animaciones y consumo de CPU/GPU en PCs lentas. */
  readonly lowPerformanceMode?: boolean;
  /** Desactivar aceleración por hardware (GPU) en el webview (requiere reiniciar). */
  readonly disableHardwareAcceleration?: boolean;
  readonly language?: string;
}
