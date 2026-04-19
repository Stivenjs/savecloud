import type { CatalogListItem, SteamAppdetailsMediaResult } from "@services/tauri";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";

const STEAM_ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

const RECOMMENDATION_COPY_VARIANTS = [
  "seleccionado por coincidencias de etiquetas dentro del catalogo.",
  "destacado por su afinidad con generos y etiquetas similares.",
  "sugerido por similitud tematica dentro del catalogo actual.",
  "elegido por relacion de categorias y estilo de juego.",
  "propuesto por patrones de etiquetas en juegos relacionados.",
];

export function getLibraryHeroUrl(appId: string): string {
  return `${STEAM_ASSET_BASE}/${appId}/library_hero.jpg`;
}

function isHeaderOrCapsuleUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes("/header.") || normalized.includes("capsule_");
}

function isHighResScreenshotUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes("/ss_") && normalized.includes("1920x1080");
}

export function prioritizeMediaUrls(urls: string[]): string[] {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return [];

  const hiResScreens = unique.filter((url) => isHighResScreenshotUrl(url));
  const regularScreens = unique.filter((url) => !isHeaderOrCapsuleUrl(url) && !isHighResScreenshotUrl(url));
  const fallbackHeaderCapsule = unique.filter((url) => isHeaderOrCapsuleUrl(url));

  return [...hiResScreens, ...regularScreens, ...fallbackHeaderCapsule];
}

export function getImageForCatalogItem(
  item: CatalogListItem | null,
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null
): string | null {
  if (!item || !mediaBySteamAppId) return null;
  const media = mediaBySteamAppId[item.steamAppId];
  if (!media) return null;

  const prioritized = prioritizeMediaUrls(media.mediaUrls);
  return prioritized[0] ?? media.capsuleImage ?? null;
}

export function getGalleryForCatalogItem(
  item: CatalogListItem,
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null
): string[] {
  const media = mediaBySteamAppId?.[item.steamAppId];
  if (!media) return [];

  const images = prioritizeMediaUrls(media.mediaUrls);
  if (images.length) return images;
  return media.capsuleImage ? [media.capsuleImage] : [];
}

export function toRouteGameId(item: CatalogListItem): string {
  return `${STEAM_CATALOG_GAME_ID_PREFIX}${item.steamAppId}`;
}

export function getSecondaryItemsForSlide(
  slides: CatalogListItem[],
  activeIndex: number,
  limit = 4
): CatalogListItem[] {
  if (slides.length <= 1) return [];

  const rest = slides.filter((_, idx) => idx !== activeIndex);
  return rest.slice(0, limit);
}

export function getRecommendationCopyVariant(): string {
  const randomIndex = Math.floor(Math.random() * RECOMMENDATION_COPY_VARIANTS.length);
  return RECOMMENDATION_COPY_VARIANTS[randomIndex];
}
