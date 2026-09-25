import type { ConfiguredGame } from "@app-types/config";

/** Prefijo estable para ids sintéticos del catálogo Steam en la app. */
export const STEAM_CATALOG_GAME_ID_PREFIX = "steam-catalog:";

/** Construye un `ConfiguredGame` mínimo a partir de la ruta `/games/:gameId` del catálogo. */
export function configuredGameFromSteamCatalogRouteId(gameId: string): ConfiguredGame | null {
  if (!gameId.startsWith(STEAM_CATALOG_GAME_ID_PREFIX)) return null;
  const steamAppId = gameId.slice(STEAM_CATALOG_GAME_ID_PREFIX.length).trim();
  if (!steamAppId) return null;
  return { id: gameId, paths: [], steamAppId };
}

export function isSteamCatalogRouteGameId(gameId: string | undefined): boolean {
  return configuredGameFromSteamCatalogRouteId(gameId ?? "") !== null;
}
