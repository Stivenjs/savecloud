import { invoke } from "@tauri-apps/api/core";

export interface SteamAppdetailsMediaResult {
  mediaUrls: string[];
  videoUrl?: string | null;
  /** Géneros (misma respuesta que medios; sin segunda llamada). */
  genres?: string[];
  /** Nombre oficial en Steam (locale del backend, p. ej. español). */
  name?: string;
  /** URL de la imagen de cápsula (icono pequeño, típicamente 231x87). */
  capsuleImage?: string | null;
}

export interface SteamAppDetailsResult {
  name: string;
  shortDescription: string;
  detailedDescription: string;
  headerImage: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  categories: string[];
  releaseDate: string | null;
  pcRequirementsMinimum: string | null;
  pcRequirementsRecommended: string | null;
  media: SteamAppdetailsMediaResult;
}

export interface ManifestSearchResult {
  steamAppId: string;
  name: string;
}

export interface CatalogSyncStats {
  mode: string;
  appsUpserted: number;
  batches: number;
}

export interface SteamSeedExportResult {
  appIdsExported: number;
  partsUploaded: number;
}

export interface SteamSeedImportResult {
  batchesProcessed: number;
  rowsUpdated: number;
}

export interface SteamSeedImportRunResult {
  rounds: number;
  batchesProcessed: number;
  rowsUpdated: number;
  trendingPriorityEntries: number;
}

export interface SteamSeedImportProgressPayload {
  iteration: number;
  batchesThisRound: number;
  rowsThisRound: number;
  totalBatches: number;
  totalRowsUpdated: number;
  done: boolean;
}

export interface SteamCatalogSyncProgressPayload {
  mode: string;
  batch: number;
  appsUpserted: number;
  done: boolean;
}

export interface SteamSeedFreshness {
  status: string;
  cloudLastBatchKey: string | null;
  localMaxBatchKey: string | null;
  error: string | null;
}

export interface CatalogListItem {
  steamAppId: string;
  name: string;
}

export interface CatalogPage {
  total: number;
  offset: number;
  limit: number;
  items: CatalogListItem[];
}

export interface CatalogFilterFacet {
  label: string;
  count: number;
}

export interface CatalogFilterFacets {
  genres: CatalogFilterFacet[];
  tags: CatalogFilterFacet[];
}

/** Busca Steam App ID por nombre de juego (scraping dinámico) */
export async function searchSteamAppId(query: string): Promise<string | null> {
  return invoke<string | null>("search_steam_app_id", { query });
}

/** Busca Steam App IDs para varias consultas en una sola operación batch (en paralelo en el backend). */
export async function searchSteamAppIdsBatch(queries: string[]): Promise<(string | null)[]> {
  if (!queries.length) return [];
  const raw = await invoke<(string | null)[]>("search_steam_app_ids_batch", {
    queries,
  });
  return raw.map((v) => v ?? null);
}

/** Obtiene el nombre del juego a partir del Steam App ID (API appdetails) */
export async function getSteamAppName(appId: string): Promise<string | null> {
  return invoke<string | null>("get_steam_app_name", { appId });
}

/** Obtiene URLs de medios (portada, capturas, thumbnails de vídeos) desde la Store API para el hovercard. */
export async function getSteamAppdetailsMedia(appId: string): Promise<SteamAppdetailsMediaResult> {
  return invoke<SteamAppdetailsMediaResult>("get_steam_appdetails_media", {
    appId,
  });
}

/** Obtiene medios para varios Steam App IDs en una sola invocación (backend hace las peticiones en paralelo). */
export async function getSteamAppdetailsMediaBatch(
  appIds: string[]
): Promise<Record<string, SteamAppdetailsMediaResult>> {
  const ids = appIds.filter((id) => id?.trim());
  if (!ids.length) return {};
  return invoke<Record<string, SteamAppdetailsMediaResult>>("get_steam_appdetails_media_batch", { appIds: ids });
}

/** Obtiene la ficha completa de un juego de Steam (descripción, requisitos, géneros, medios). */
export async function getSteamAppDetails(appId: string): Promise<SteamAppDetailsResult> {
  return invoke<SteamAppDetailsResult>("get_steam_app_details", { appId });
}

/** Fuerza la actualización de la ficha de un juego de Steam desde la Store API y actualiza SQLite. */
export async function forceRefreshSteamAppDetails(appId: string): Promise<SteamAppDetailsResult> {
  return invoke<SteamAppDetailsResult>("force_refresh_steam_app_details", { appId });
}

/** Busca juegos en Steam por nombre (sugerencias rápidas) */
export async function searchSteamGames(query: string): Promise<ManifestSearchResult[]> {
  if (!query.trim()) return [];
  return invoke<ManifestSearchResult[]>("search_steam_games", { query });
}

/** Sincroniza el catálogo Steam en SQLite (requiere clave Steam Web API). */
export async function syncSteamCatalog(): Promise<CatalogSyncStats> {
  return invoke<CatalogSyncStats>("sync_steam_catalog");
}

/** Borra metadatos de sync del catálogo; la próxima ejecución hará sync completo de nuevo. */
export async function resetSteamCatalogSync(): Promise<void> {
  await invoke("reset_steam_catalog_sync");
}

/** Exporta appids del catálogo local a S3 (manifest para steam-seed). */
export async function exportSteamSeedManifestToCloud(partSize?: number): Promise<SteamSeedExportResult> {
  return invoke<SteamSeedExportResult>("sync_export_steam_manifest_to_cloud_seed", {
    partSize: partSize ?? null,
  });
}

/** Resetea state.json del steam-seed activo (owner propio o host activo). */
export async function resetCloudSeedState(): Promise<void> {
  await invoke("sync_reset_cloud_seed_state");
}

/** Importa una sola tanda de batches del steam-seed a SQLite (uso avanzado). */
export async function importCloudSeedBatchesToSqlite(
  maxBatches?: number,
  strategy?: string,
  concurrency?: number
): Promise<SteamSeedImportResult> {
  return invoke<SteamSeedImportResult>("sync_import_cloud_seed_batches_to_sqlite", {
    maxBatches: maxBatches ?? null,
    strategy: strategy ?? null,
    concurrency: concurrency ?? null,
  });
}

/**
 * Descarga todas las tandas disponibles hasta agotar el catálogo en la nube (un solo clic).
 * Al terminar, aplica el ranking de prioridad desde `priority_appids.jsonl` si existe.
 */
export async function importCloudSeedRunUntilDone(options?: {
  maxBatches?: number;
  strategy?: string;
  concurrency?: number;
}): Promise<SteamSeedImportRunResult> {
  return invoke<SteamSeedImportRunResult>("sync_import_cloud_seed_run_until_done", {
    maxBatches: options?.maxBatches ?? null,
    strategy: options?.strategy ?? null,
    concurrency: options?.concurrency ?? null,
  });
}

/** Consulta GET /saves/steam-seed/status y el estado local (sin listar todo S3). */
export async function getSteamSeedFreshness(): Promise<SteamSeedFreshness> {
  return invoke<SteamSeedFreshness>("sync_get_steam_seed_freshness");
}

/**
 * Actualiza el orden de “tendencia” desde la tienda pública (más vendidos, ofertas, novedades).
 * No requiere clave Steam Web API. Devuelve cuántas apps quedaron en el ranking local.
 */
export async function syncSteamStoreTrending(): Promise<number> {
  return invoke<number>("sync_steam_store_trending");
}

/** Facetas para filtros del catálogo (solo juegos con ficha descargada). */
export async function getSteamCatalogFilterFacets(): Promise<CatalogFilterFacets> {
  return invoke<CatalogFilterFacets>("get_steam_catalog_filter_facets");
}

/** Búsqueda por nombre en el catálogo (tokens AND, relevancia; mín. 2 caracteres útiles en el backend). */
export async function searchSteamCatalog(
  query: string,
  limit?: number,
  genres?: string[] | null,
  tags?: string[] | null
): Promise<CatalogListItem[]> {
  return invoke<CatalogListItem[]>("search_steam_catalog", {
    query,
    limit: limit ?? null,
    genres: genres?.length ? genres : null,
    tags: tags?.length ? tags : null,
  });
}

/**
 * Listado paginado: primero tendencia (`syncSteamStoreTrending`); luego entradas con ficha enriquecida,
 * `enriched_at`, actividad del seed y `app_id` como desempate (no solo ID alto).
 */
export async function listSteamCatalogPage(
  offset?: number,
  limit?: number,
  genres?: string[] | null,
  tags?: string[] | null,
  cachedTotal?: number | null
): Promise<CatalogPage> {
  return invoke<CatalogPage>("list_steam_catalog_page", {
    offset: offset ?? null,
    limit: limit ?? null,
    genres: genres?.length ? genres : null,
    tags: tags?.length ? tags : null,
    cachedTotal: cachedTotal ?? null,
  });
}

/** Top de juegos en tendencia para el hero de la primera vista del catálogo. */
export async function listSteamCatalogTrendingHero(limit?: number): Promise<CatalogListItem[]> {
  return invoke<CatalogListItem[]>("list_steam_catalog_trending_hero", {
    limit: limit ?? null,
  });
}

/**
 * Ficha completa desde el catálogo local: caché → JSON en disco → Store API.
 * Misma forma que `getSteamAppDetails`, pero exige que el `appId` exista en el catálogo sincronizado.
 */
export async function getSteamCatalogAppDetails(appId: string): Promise<SteamAppDetailsResult> {
  return invoke<SteamAppDetailsResult>("get_steam_catalog_app_details", { appId });
}

/** Nombre del listado local del catálogo (p. ej. inglés); no el título localizado de Store API. */
export function getSteamCatalogListingName(appId: string): Promise<string | null> {
  return invoke<string | null>("get_steam_catalog_listing_name", { appId });
}

/** Obtiene los nombres de los juegos de Steam en batch. */
export async function getSteamAppNamesBatch(appIds: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_steam_app_names_batch", { appIds });
}
