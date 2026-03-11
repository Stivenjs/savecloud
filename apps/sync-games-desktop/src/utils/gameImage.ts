import type { ConfiguredGame } from "@app-types/config";

const STEAM_CDN_BASE = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/**
 * Obtiene la URL de la imagen del juego.
 *
 * Prioridad:
 * 1. imageUrl (config)
 * 2. steamAppId (config o resuelto dinámicamente)
 * 3. App ID extraído del id (ej. empress-re4-2050650 → 2050650)
 * 4. id numérico puro
 * 5. null → placeholder
 */
export function getGameImageUrl(
  game: ConfiguredGame,
  resolvedSteamAppId?: string | null
): string | null {
  if (game.imageUrl?.trim()) {
    return game.imageUrl.trim();
  }

  const appId =
    game.steamAppId?.trim() ??
    resolvedSteamAppId?.trim() ??
    extractAppIdFromId(game.id) ??
    (isSteamAppId(game.id) ? game.id : null);

  if (appId) {
    return `${STEAM_CDN_BASE}/${appId}/header.jpg`;
  }

  return null;
}

/** Devuelve el Steam App ID si existe (config o resuelto o extraído del id). */
export function getSteamAppId(
  game: ConfiguredGame,
  resolvedSteamAppId?: string | null
): string | null {
  if (
    game.imageUrl?.trim() &&
    !game.steamAppId?.trim() &&
    !resolvedSteamAppId?.trim()
  ) {
    return null;
  }
  return (
    game.steamAppId?.trim() ??
    resolvedSteamAppId?.trim() ??
    extractAppIdFromId(game.id) ??
    (isSteamAppId(game.id) ? game.id : null)
  );
}

/**
 * URL de imagen extra para hovercard (library hero de Steam).
 * Muchos juegos tienen esta imagen; si no existe devolverá 404.
 */
export function getGameLibraryHeroUrl(
  game: ConfiguredGame,
  resolvedSteamAppId?: string | null
): string | null {
  const appId = getSteamAppId(game, resolvedSteamAppId);
  if (!appId) return null;
  return `${STEAM_CDN_BASE}/${appId}/library_hero.jpg`;
}

/**
 * Extrae Steam App ID del id cuando sigue convenciones de cracks (ej. -2050650).
 */
export function extractAppIdFromId(id: string): string | null {
  const match = id.trim().match(/-(\d{4,10})$/);
  return match ? match[1] : null;
}

/**
 * Extrae Steam App ID de un folderName como "EMPRESS — 2050650" o "Steam App 2551020".
 */
export function extractAppIdFromFolderName(folderName: string): string | null {
  const match = folderName.trim().match(/\b(\d{4,10})\b/);
  return match ? match[1] : null;
}

/** Convierte un nombre de carpeta en un id de juego (ej. "Elden Ring" → "elden-ring"). */
export function toGameId(folderName: string): string {
  return (
    folderName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "game"
  );
}

/** Comprueba si el id parece un Steam App ID (solo dígitos). */
export function isSteamAppId(id: string): boolean {
  return /^\d{4,10}$/.test(id.trim());
}

/** Indica si el juego necesita búsqueda dinámica (no tiene imagen aún). */
export function needsSteamSearch(game: ConfiguredGame): boolean {
  if (game.imageUrl?.trim()) return false;
  if (game.steamAppId?.trim()) return false;
  if (extractAppIdFromId(game.id)) return false;
  if (isSteamAppId(game.id)) return false;
  return true;
}

/**
 * Convierte el id del juego a un término de búsqueda para Steam.
 * Quita prefijos de cracks (empress-, codex-, fitgirl-, etc.) y sustituye guiones por espacios.
 */
export function idToSearchQuery(id: string): string {
  const knownPrefixes = [
    "empress-",
    "codex-",
    "fitgirl-",
    "dodi-",
    "scene-",
    "goldberg-",
    "steamless-",
  ];
  let cleaned = id.trim();
  for (const prefix of knownPrefixes) {
    if (cleaned.toLowerCase().startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }
  // Quitar sufijos como -crack, -repack, -x64
  cleaned = cleaned.replace(/-?(crack|repack|x64|x86|v[0-9.]+)$/i, "");
  return cleaned.replace(/-/g, " ").trim() || id.replace(/-/g, " ");
}

/**
 * Convierte el id del juego a un nombre legible para mostrar.
 * Quita prefijos de cracks, sufijos numéricos, y aplica formato título.
 */
export function formatGameDisplayName(id: string): string {
  let cleaned = idToSearchQuery(id);
  // Quitar Steam App ID al final (ej. "resident evil 4 2050650" → "resident evil 4")
  cleaned = cleaned.replace(/\s+\d{4,10}$/, "");
  // Title case: primera letra de cada palabra en mayúscula
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Filtra juegos por término de búsqueda (id o nombre formateado).
 * Búsqueda case-insensitive y por coincidencia parcial.
 */
export function filterGamesBySearch(
  games: readonly ConfiguredGame[],
  searchTerm: string
): ConfiguredGame[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return [...games];
  return games.filter((game) => {
    const id = game.id.toLowerCase();
    const displayName = formatGameDisplayName(game.id).toLowerCase();
    return id.includes(term) || displayName.includes(term);
  });
}

/** Indica si el juego tiene asociado Steam (por steamAppId o id con app id). */
export function isSteamGame(game: ConfiguredGame): boolean {
  if (game.steamAppId?.trim()) return true;
  if (extractAppIdFromId(game.id)) return true;
  if (isSteamAppId(game.id)) return true;
  return false;
}
