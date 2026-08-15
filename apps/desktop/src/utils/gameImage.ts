import type { ConfiguredGame } from "@app-types/config";

const STEAM_FASTLY_CDN_BASE = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps";
const STEAM_AKAMAI_CDN_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const STEAM_CLOUDFLARE_CDN_BASE = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/**
 * Devuelve la lista jerárquica de URLs candidatas para la portada de una aplicación de Steam.
 */
export function getSteamCdnCandidates(appId: string): string[] {
  const cleanId = appId.trim();
  if (!cleanId) return [];
  return [
    `${STEAM_FASTLY_CDN_BASE}/${cleanId}/header.jpg`,
    `${STEAM_AKAMAI_CDN_BASE}/${cleanId}/header.jpg`,
    `${STEAM_CLOUDFLARE_CDN_BASE}/${cleanId}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${cleanId}/header.jpg`,
    `${STEAM_FASTLY_CDN_BASE}/${cleanId}/capsule_616x353.jpg`,
    `${STEAM_CLOUDFLARE_CDN_BASE}/${cleanId}/capsule_616x353.jpg`,
    `${STEAM_FASTLY_CDN_BASE}/${cleanId}/library_hero.jpg`,
    `${STEAM_CLOUDFLARE_CDN_BASE}/${cleanId}/library_hero.jpg`,
  ];
}

/**
 * Obtiene la URL de la imagen del juego.
 *
 * Prioridad:
 * 1. imageUrl (config - imagen personalizada)
 * 2. steamAppId (config o resuelto dinámicamente)
 * 3. App ID extraído del id (ej. empress-re4-2050650 → 2050650)
 * 4. id numérico puro
 * 5. null → fallback al frontend (Gamepad icon)
 *
 * @deprecated Usa gameMedia hook para manejo correcto de medios con fallback de API de Steam, o construye URLs de CDN de Steam directamente.
 */
export function getGameImageUrl(game: ConfiguredGame, resolvedSteamAppId?: string | null): string | null {
  if (game.imageUrl?.trim()) {
    return game.imageUrl.trim();
  }

  const appId = getSteamAppId(game, resolvedSteamAppId);

  if (appId) {
    return `${STEAM_FASTLY_CDN_BASE}/${appId}/header.jpg`;
  }

  return null;
}

/** Devuelve el Steam App ID si existe (config o resuelto o extraído del id). */
export function getSteamAppId(game: ConfiguredGame, resolvedSteamAppId?: string | null): string | null {
  if (game.imageUrl?.trim() && !game.steamAppId?.trim() && !resolvedSteamAppId?.trim()) {
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
 */
export function getGameLibraryHeroUrl(game: ConfiguredGame, resolvedSteamAppId?: string | null): string | null {
  const appId = getSteamAppId(game, resolvedSteamAppId);
  if (!appId) return null;
  return `${STEAM_FASTLY_CDN_BASE}/${appId}/library_hero.jpg`;
}

/**
 * Miniaturas de trailers en la API de Steam (`movie_max.jpg`, etc.): baja calidad; no usar en hero.
 * (El backend ya no las mezcla; esto filtra cachés antiguas o URLs sueltas.)
 */
export function isSteamMoviePosterUrl(url: string): boolean {
  return /\/steam\/apps\/\d+\/movie[^/]*$/i.test(url.trim());
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
 * Evita extraer números que son años o números cortos de títulos de juegos (ej. "Cyberpunk 2077").
 */
export function extractAppIdFromFolderName(folderName: string): string | null {
  const trimmed = folderName.trim();
  if (/^\d{4,10}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\b(\d{4,10})\b/);
  if (match) {
    const num = match[1];
    if (num.length >= 6) {
      return num;
    }
    const lower = trimmed.toLowerCase();
    if (
      lower.includes("steam") ||
      lower.includes("gse") ||
      lower.includes("goldberg") ||
      lower.includes("empress") ||
      lower.includes("rune") ||
      lower.includes("flt") ||
      lower.includes("codex")
    ) {
      return num;
    }
  }
  return null;
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
 * Limpia el ruido estructural (sufijos, versiones, tags) sin importar el grupo que lo subió,
 * y sustituye guiones por espacios.
 */
export function idToSearchQuery(id: string): string {
  let cleaned = id.trim();

  // 1. Eliminar Steam AppIDs al final (ej: "resident-evil-4-2050650" -> "resident-evil-4")
  cleaned = cleaned.replace(/-\d{4,10}$/, "");

  // 2. Eliminar sufijos técnicos/piratas genéricos (sin importar quién lo subió)
  // Atrapa cosas como: -crack, -repack, -v1.0.3, -build-234, -multi12, -p2p, -rip
  cleaned = cleaned.replace(/-(crack|repack|rip|p2p|x64|x86|v\d+[.\d]*|build-?\d+|multi\d+).*$/i, "");

  // 3. Reemplazar los guiones restantes por espacios
  return cleaned.replace(/-/g, " ").trim() || id.replace(/-/g, " ");
}

const displayNameCache = new Map<string, string>();

/**
 * Convierte el id del juego a un nombre legible para mostrar.
 * Quita sufijos numéricos, aplica formato título y utiliza caché para máximo rendimiento.
 */
export function formatGameDisplayName(id: string): string {
  if (displayNameCache.has(id)) {
    return displayNameCache.get(id)!;
  }

  let cleaned = idToSearchQuery(id);
  cleaned = cleaned.replace(/\s+\d{4,10}$/, "");

  const result = cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  displayNameCache.set(id, result);
  return result;
}

/**
 * Filtra juegos por término de búsqueda (id o nombre formateado).
 * Búsqueda case-insensitive y por coincidencia parcial.
 */
export function filterGamesBySearch(games: readonly ConfiguredGame[], searchTerm: string): ConfiguredGame[] {
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
