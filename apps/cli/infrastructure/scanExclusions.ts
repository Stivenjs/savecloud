/**
 * Configuración de exclusión para el escaneo de carpetas.
 * Nombres y patrones que se omiten al buscar guardados de juegos.
 */

/** Nombres exactos de carpeta que no son juegos (comparación en minúsculas). */
export const EXCLUDED_FOLDER_NAMES = new Set([
  // Sistema / raíz de Windows
  "windows",
  "users",
  "program files",
  "program files (x86)",
  "programdata",
  "recovery",
  "perflogs",
  "$recycle.bin",
  "system volume information",
  "msocache",
  "boot",
  "intel",
  "amd",
  // Editores / IDEs
  "code",
  "cursor",
  "visual studio setup",
  "git extensions",
  "gitextensions",
  "github-copilot",
  "cmaketools",
  "visualstudiodiscordrpc",
  "jetbrains",
  // Comunicación / social
  "discord",
  "spotify",
  "zoom",
  "slack",
  "telegram desktop",
  "whatsapp",
  // Navegadores / sistema
  "google",
  "microsoft",
  "nvidia corporation",
  "connecteddevicesplatform",
  "mozilla",
  "chrome",
  "firefox",
  "edge",
  "opera",
  "brave",
  // Gestores de paquetes / dev
  "npm",
  "pnpm",
  "pnpm-state",
  "node_modules",
  "packages",
  "amplify",
  "turborepo",
  "nextjs-nodejs",
  "theme-liquid-docs-nodejs",
  ".bun",
  ".npm",
  ".cache",
  ".local",
  ".config",
  // Utilidades
  "obs-studio",
  "qbittorrent",
  "utorrent web",
  "winrar",
  "7-zip",
  "process hacker 2",
  "xdg.config",
  "ccleaner",
  // Launchers / plataformas
  "steam",
  "steamlibrary",
  "sklauncher",
  "riot-client-ux",
  "riot games",
  "firestorm launcher",
  "launcher-updater",
  "overwolf",
  "overframe-ow-app-updater",
  "overframe",
  "wago-app",
  "wago-app-updater",
  "battleye",
  "epic games",
  "ea games",
  "ubisoft",
  "gog galaxy",
  "battle.net",
  // Roblox
  "roblox",
  "robloxpcgdk",
  // Temp / basura
  "temp",
  "tmp",
  "crashdumps",
  "squirreltemp",
  "programs",
  "logs",
  "cache",
  // Nuestro propio config
  "SaveCloud",
]);

/**
 * Patrones parciales: si el nombre de la carpeta contiene alguno de estos, se excluye.
 * Útil para carpetas como "Server_Pack", "Backup_2024", etc.
 */
export const EXCLUDED_PARTIAL_PATTERNS: readonly string[] = [
  "server_pack",
  "server pack",
  "_server",
  "backup",
  "driver",
  "installer",
  "setup",
  "redistributable",
  "redist",
  "runtime",
  "sdk",
  "dotnet",
  ".net",
  "visual c++",
  "vcredist",
  "directx",
];
