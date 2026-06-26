import { invoke } from "@tauri-apps/api/core";
import type { Config } from "@app-types/config";
import type { GameSaveGraph } from "@app-types/saveGraph";
import { dedupePreserveGamePaths } from "@utils/gameSavePaths";

export interface PluginLogEntry {
  timestamp: string;
  level: "info" | "error";
  plugin: string;
  message: string;
}

export interface PathCandidate {
  path: string;
  folderName: string;
  basePath: string;
  /** Steam App ID cuando se conoce (manifiesto o ruta Steam). */
  steamAppId?: string | null;
  /** Varias rutas de guardado para el mismo juego; al añadir se registran todas. */
  paths?: string[] | null;
}

/** Obtiene la configuración desde el archivo compartido con el CLI */
export async function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

/** Guarda fondo, avatar y marco del perfil (vacío o null borra cada campo). */
export async function setProfileAppearance(updates: {
  profileBackground?: string | null;
  profileAvatar?: string | null;
  profileFrame?: string | null;
}): Promise<void> {
  await invoke("set_profile_appearance", {
    profileBackground: updates.profileBackground ?? null,
    profileAvatar: updates.profileAvatar ?? null,
    profileFrame: updates.profileFrame ?? null,
  });
}

export async function setShareVisualProfileWithHosts(enabled: boolean): Promise<void> {
  await invoke("set_share_visual_profile_with_hosts", { enabled });
}

export async function setShareVisualProfileWithMembers(enabled: boolean): Promise<void> {
  await invoke("set_share_visual_profile_with_members", { enabled });
}

export type StartupWindowMode = "normal" | "big_picture";

/** Preferencia de arranque: ventana normal o Big Picture (pantalla completa en la ventana principal). */
export async function setStartupWindowMode(mode: StartupWindowMode): Promise<void> {
  await invoke("set_startup_window_mode", { mode });
}

/** Ruta del archivo de configuración (para mostrar al usuario) */
export async function getConfigPath(): Promise<string> {
  return invoke<string>("get_config_path");
}

export async function getDefaultSourceDownloadDir(): Promise<string | null> {
  return invoke<string | null>("get_default_source_download_dir");
}

export async function setDefaultSourceDownloadDir(path: string | null): Promise<void> {
  await invoke("set_default_source_download_dir", { path: path?.trim() || null });
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

/**
 * Respuesta ligera de Store `appdetails` (una petición por app): galería, vídeo, géneros y nombre en tienda.
 * No incluye descripciones largas ni requisitos — adecuado para listas tipo biblioteca.
 */
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

/** Ficha completa de un juego de Steam: descripción, requisitos, géneros, medios, etc. */
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

/** Obtiene la ficha completa de un juego de Steam (descripción, requisitos, géneros, medios). */
export async function getSteamAppDetails(appId: string): Promise<SteamAppDetailsResult> {
  return invoke<SteamAppDetailsResult>("get_steam_app_details", { appId });
}

/** Fuerza la actualización de la ficha de un juego de Steam desde la Store API y actualiza SQLite. */
export async function forceRefreshSteamAppDetails(appId: string): Promise<SteamAppDetailsResult> {
  return invoke<SteamAppDetailsResult>("force_refresh_steam_app_details", { appId });
}

/** Proceso visible en el selector manual (nombre como en el Administrador de tareas + icono del .exe en Windows). */
export interface RunningProcessPickRow {
  name: string;
  iconPngBase64?: string | null;
}

/** Lista procesos en ejecución para asignar detección manual (iconos donde el backend los pueda obtener). */
export function listRunningProcessesForPick(): Promise<RunningProcessPickRow[]> {
  return invoke<RunningProcessPickRow[]>("list_running_processes_for_pick");
}

/** Inicia el ejecutable configurado para el juego. */
export function launchGame(gameId: string): Promise<void> {
  return invoke("launch_game", { gameId });
}

/** Guarda la ruta al programa para abrir el juego (.exe, .jar, …; `null` borra). */
export function setGameLaunchExecutable(gameId: string, path: string | null): Promise<void> {
  return invoke("set_game_launch_executable", { gameId, path });
}

/**
 * Fija los nombres de proceso para detectar si el juego está en ejecución.
 * Array vacío restaura la detección automática.
 */
export function setGameExecutableNames(gameId: string, names: string[]): Promise<void> {
  return invoke("set_game_executable_names", { gameId, names });
}

/** Comprueba si un único juego está en ejecución (para mostrar advertencia) */
export function checkGameRunning(gameId: string): Promise<boolean> {
  return invoke<boolean>("check_game_running", { gameId });
}

/** Comprueba el estado de ejecución de varios juegos en una sola llamada */
export function checkGamesRunning(gameIds: readonly string[]): Promise<Record<string, boolean>> {
  if (!gameIds.length) return Promise.resolve({});
  return invoke<Record<string, boolean>>("check_games_running", {
    gameIds,
  });
}

/** Añade un juego a la configuración (`paths` pueden ser varias carpetas de guardados). */
export async function addGame(
  gameId: string,
  pathsInput: readonly string[],
  editionLabel?: string,
  sourceUrl?: string,
  steamAppId?: string,
  imageUrl?: string
): Promise<void> {
  const paths = dedupePreserveGamePaths(pathsInput);
  await invoke("add_game", {
    gameId,
    paths,
    editionLabel: editionLabel?.trim() || null,
    sourceUrl: sourceUrl?.trim() || null,
    steamAppId: steamAppId?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
  });
}

export interface ManifestSearchResult {
  steamAppId: string;
  name: string;
}

/** Busca juegos en Steam por nombre (sugerencias rápidas) */
export async function searchSteamGames(query: string): Promise<ManifestSearchResult[]> {
  if (!query.trim()) return [];
  return invoke<ManifestSearchResult[]>("search_steam_games", { query });
}

/** Abre la carpeta de guardados del juego en el explorador */
export async function openSaveFolder(gameId: string): Promise<void> {
  await invoke("open_save_folder", { gameId });
}

/** Exporta la configuración a un archivo JSON. Devuelve el path. */
export async function exportConfigToFile(path: string): Promise<string> {
  return invoke("export_config_to_file", { path });
}

/** Sube config.json a la nube como "__config__/config.json" */
export async function backupConfigToCloud(): Promise<void> {
  await invoke("backup_config_to_cloud");
}

const CONFIG_BACKUP_DEBOUNCE_MS = 2500;
let configBackupTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa un respaldo del config a la nube tras un breve retraso.
 * Si se vuelve a llamar antes de que se ejecute, se reinicia el temporizador.
 * Útil para mantener la nube actualizada tras añadir/editar/eliminar juegos o cambiar configuración.
 */
export function scheduleConfigBackupToCloud(): void {
  if (configBackupTimeoutId) clearTimeout(configBackupTimeoutId);
  configBackupTimeoutId = setTimeout(() => {
    configBackupTimeoutId = null;
    backupConfigToCloud().catch(() => {
      // Fallo silencioso para no molestar; el usuario puede usar "Subir a la nube" manual.
    });
  }, CONFIG_BACKUP_DEBOUNCE_MS);
}

/** Restaura config.json desde la nube (última versión) */
export async function restoreConfigFromCloud(): Promise<void> {
  await invoke("restore_config_from_cloud");
}

/** Indica si la API devuelve URLs con S3 Transfer Acceleration ("accelerated" | "standard" | "unknown"). */
export async function getS3TransferEndpointType(): Promise<"accelerated" | "standard" | "unknown"> {
  const result = await invoke<string>("get_s3_transfer_endpoint_type");
  if (result === "accelerated" || result === "standard") return result;
  return "unknown";
}

/** Obtiene la configuración de un amigo desde la nube (solo lectura) */
export async function getFriendConfig(friendUserId: string): Promise<Config> {
  return invoke<Config>("get_friend_config", { friendUserId });
}

/** Obtiene las configuraciones de varios amigos desde la nube en un solo lote (batch) */
export async function getFriendsConfigs(friendUserIds: string[]): Promise<Record<string, Config | null>> {
  if (friendUserIds.length === 0) return {};
  return invoke<Record<string, Config | null>>("get_friends_configs", { friendUserIds });
}

/** Añade a tu config solo los juegos del amigo que no tienes (por id). No modifica apiKey ni userId. */
export async function addGamesFromFriend(
  friendGames: readonly {
    id: string;
    paths: string[];
    steamAppId?: string;
    imageUrl?: string;
    editionLabel?: string;
    sourceUrl?: string;
  }[]
): Promise<number> {
  return invoke<number>("add_games_from_friend", {
    friendGames: [...friendGames],
  });
}

/** Resultado de `sync_steam_catalog` (serde camelCase en el backend). */
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

/** Payload emitido por el backend durante `sync_import_cloud_seed_run_until_done`. */
export interface SteamSeedImportProgressPayload {
  iteration: number;
  batchesThisRound: number;
  rowsThisRound: number;
  totalBatches: number;
  totalRowsUpdated: number;
  done: boolean;
}

/** Payload emitido durante `sync_steam_catalog` por cada lote. */
export interface SteamCatalogSyncProgressPayload {
  mode: string;
  batch: number;
  appsUpserted: number;
  done: boolean;
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

/** Resultado de comparar el último batch del worker en S3 con el máximo importado en SQLite. */
export interface SteamSeedFreshness {
  status: string;
  cloudLastBatchKey: string | null;
  localMaxBatchKey: string | null;
  error: string | null;
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

/** Ítem del catálogo local; mismo criterio camelCase que el backend. */
export interface CatalogListItem {
  steamAppId: string;
  name: string;
}

/** Página del catálogo local con total global (o total filtrado si hay géneros/etiquetas). */
export interface CatalogPage {
  total: number;
  offset: number;
  limit: number;
  items: CatalogListItem[];
}

/** Faceta de filtro (género o etiqueta) con número de juegos enriquecidos que la tienen. */
export interface CatalogFilterFacet {
  label: string;
  count: number;
}

export interface CatalogFilterFacets {
  genres: CatalogFilterFacet[];
  tags: CatalogFilterFacet[];
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
 *
 * `cachedTotal` — si el frontend ya conoce el total (p. ej. de la primera página con los mismos filtros),
 * lo pasa aquí para omitir la costosa query COUNT en el backend (~50 % de ahorro por página).
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

/** Crea o actualiza el archivo de configuración con apiBaseUrl, apiKey y userId. Opcionalmente la clave Steam Web API (se guarda en el almacén seguro del SO). Devuelve la ruta del archivo. */
export async function createConfigFile(
  apiBaseUrl: string,
  wsBaseUrl: string,
  apiKey: string,
  userId: string,
  steamWebApiKey?: string | null
): Promise<string> {
  return invoke<string>("create_config_file", {
    apiBaseUrl: apiBaseUrl.trim() || null,
    wsBaseUrl: wsBaseUrl.trim() || null,
    apiKey: apiKey.trim() || null,
    userId: userId.trim() || null,
    steamWebApiKey: steamWebApiKey === undefined || steamWebApiKey === null ? null : steamWebApiKey.trim() || null,
  });
}

/**
 * Establece la URL del servidor WebSocket para un host específico.
 */
export async function setCloudHostWsUrl(hostUserId: string, wsUrl: string): Promise<void> {
  return invoke("set_cloud_host_ws_url", { hostUserId, wsUrl });
}

/** Selecciona la nube activa para sync: `null` = nube propia, string = nube del host. */
export async function setActiveCloudHostUserId(hostUserId: string | null): Promise<void> {
  await invoke("set_active_cloud_host_user_id", {
    hostUserId: hostUserId?.trim() || null,
  });
}

/** Importa configuración de un amigo directamente desde la nube reemplazando la local (no toca credentials locales) */
export async function importFriendConfig(friendUserId: string): Promise<void> {
  await invoke("import_friend_config", { friendUserId });
}

/** Importa configuración desde archivo. mode: "merge" | "replace" */
export async function importConfigFromFile(path: string, mode: "merge" | "replace"): Promise<void> {
  await invoke("import_config_from_file", { path, mode });
}

/** Actualiza un juego existente (rutas y metadatos). */
export async function updateGame(
  gameId: string,
  paths: string[],
  editionLabel?: string,
  sourceUrl?: string,
  steamAppId?: string,
  imageUrl?: string
): Promise<void> {
  await invoke("update_game", {
    gameId,
    paths,
    editionLabel: editionLabel?.trim() || null,
    sourceUrl: sourceUrl?.trim() || null,
    steamAppId: steamAppId?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
  });
}

/** Lee un archivo de imagen y devuelve su data URL (base64). Para portadas personalizadas. */
export async function readImageAsDataUrl(path: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { path });
}

/** Elimina un juego (o una ruta concreta) de la configuración */
export async function removeGame(gameId: string, path?: string): Promise<void> {
  await invoke("remove_game", { gameId, path });
}

/** Borra todos los guardados del juego en la nube (S3) */
export async function deleteGameFromCloud(gameId: string): Promise<void> {
  await invoke("sync_delete_game_from_cloud", { gameId });
}

/** Renombra un juego en la nube (copia a nuevo id y borra el prefijo antiguo) */
export async function renameGameInCloud(oldGameId: string, newGameId: string): Promise<void> {
  await invoke("sync_rename_game_in_cloud", {
    oldGameId,
    newGameId,
  });
}

/** Renombra un juego en la configuración local (cambia su id) */
export async function renameGame(oldGameId: string, newGameId: string): Promise<void> {
  await invoke("rename_game", { oldGameId, newGameId });
}

/** Entrada del historial de operaciones (subidas, descargas, copias de amigos) */
export interface OperationLogEntry {
  timestamp: string;
  kind: "upload" | "download" | "copy_friend";
  gameId: string;
  fileCount: number;
  errCount: number;
}

/** Lista el historial de operaciones */
export async function listOperationHistory(): Promise<OperationLogEntry[]> {
  return invoke<OperationLogEntry[]>("list_operation_history");
}

/** Devuelve el mapa visual de guardados de un juego concreto. */
export async function getGameSaveGraph(gameId: string): Promise<GameSaveGraph> {
  return invoke<GameSaveGraph>("get_game_save_graph", { gameId });
}

/** Escanea el sistema en busca de carpetas candidatas para guardados */
export async function scanPathCandidates(): Promise<PathCandidate[]> {
  return invoke<PathCandidate[]>("scan_path_candidates");
}

/** Resultado de subida o descarga */
export interface SyncResult {
  okCount: number;
  errCount: number;
  errors: string[];
}

export interface ActiveDownloadState {
  id: string;
  kind: "upload" | "download";
  gameId: string | null;
  name: string;
  state: "queued" | "running" | "paused" | "completed" | "failed";
  loaded: number;
  total: number;
}

/** Sube los guardados de un juego a la nube */
export async function syncUploadGame(gameId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("sync_upload_game", { gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Resultado por juego de una operación batch (subir/descargar todos). */
export interface GameSyncResult {
  gameId: string;
  result: SyncResult;
}

/** Sube los guardados de todos los juegos a la nube (operación batch). */
export async function syncUploadAllGames(): Promise<GameSyncResult[]> {
  const list = await invoke<{ gameId: string; result: SyncResult }[]>("sync_upload_all_games");
  return list.map(({ gameId, result }) => ({
    gameId,
    result: {
      okCount: result.okCount,
      errCount: result.errCount,
      errors: result.errors,
    },
  }));
}

/** Solicita cancelar la subida en curso (solo tiene efecto en subidas multipart entre partes). */
export function requestUploadCancel(): Promise<void> {
  return invoke("request_upload_cancel");
}

/** Solicita pausar la subida en curso. El estado se guarda y se puede reanudar con syncUploadResume. */
export function requestUploadPause(): Promise<void> {
  return invoke("request_upload_pause");
}

export interface PausedUploadInfo {
  gameId: string;
  filename: string;
}

/** Devuelve la info de la subida pausada, si existe (para mostrar "Reanudar" en la UI). */
export function getPausedUploadInfo(): Promise<PausedUploadInfo | null> {
  return invoke<PausedUploadInfo | null>("get_paused_upload_info");
}

/** Reanuda la subida multipart guardada tras pausar. */
export function syncUploadResume(): Promise<SyncResult> {
  return invoke<{ okCount: number; errCount: number; errors: string[] }>("sync_upload_resume").then((r) => ({
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  }));
}

/** Copia los guardados de un amigo para un juego concreto a tu cuenta */
export async function copyFriendSaves(friendUserId: string, gameId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("copy_friend_saves", { friendUserId, gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Plan de copia de archivos desde un amigo (manejo avanzado de conflictos) */
export interface CopyFriendFilePlan {
  key: string;
  filename: string;
  targetFilename: string;
}

/** Copia los guardados de un amigo usando un plan detallado (permite omitir/renombrar) */
export async function copyFriendSavesWithPlan(
  friendUserId: string,
  gameId: string,
  plan: CopyFriendFilePlan[]
): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("copy_friend_saves_with_plan", { friendUserId, gameId, plan });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Información de un guardado en la nube */
export interface RemoteSaveInfo {
  gameId: string;
  key: string;
  filename: string;
  lastModified: string;
  size?: number;
}

/** Resumen agregado de guardados en la nube por juego (para UI y “última sync”). */
export interface CloudSavesSummary {
  gameId: string;
  fileCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

/** Lista todos los guardados del usuario en la nube (para última sincronización, etc.) */
export async function syncListRemoteSaves(): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves");
}

/** Resumen agregado por juego (más rápido que listar todos los archivos). */
export async function syncListRemoteSavesSummary(): Promise<CloudSavesSummary[]> {
  return invoke<CloudSavesSummary[]>("sync_list_remote_saves_summary");
}

/** Lista todos los guardados en la nube de otro usuario (amigo) */
export async function syncListRemoteSavesForUser(userId: string): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves_for_user", {
    userId,
  });
}

/** Conflicto de descarga: archivo local más reciente que en la nube */
export interface DownloadConflict {
  filename: string;
  localModified: string;
  cloudModified: string;
}

/** Comprueba si hay conflictos (archivos locales más recientes que en la nube) */
export async function syncCheckDownloadConflicts(gameId: string): Promise<{ conflicts: DownloadConflict[] }> {
  return invoke<{ conflicts: DownloadConflict[] }>("sync_check_download_conflicts", { gameId });
}

/** Comprueba conflictos de descarga para varios juegos en una sola llamada */
export async function syncCheckDownloadConflictsBatch(
  gameIds: string[]
): Promise<{ gameId: string; conflicts: DownloadConflict[] }[]> {
  if (gameIds.length === 0) return [];
  return invoke<{ gameId: string; conflicts: DownloadConflict[] }[]>("sync_check_download_conflicts_batch", {
    gameIds,
  });
}

/** Juegos con guardados locales no subidos a la nube */
export interface UnsyncedGame {
  gameId: string;
}

/** Estadísticas por juego (tamaño local, últimas modificaciones) */
export interface GameStats {
  gameId: string;
  localSizeBytes: number;
  localLastModified: string | null;
  cloudLastModified: string | null;
  playtimeSeconds: number;
}

/** Obtiene estadísticas de todos los juegos configurados */
export async function getGameStats(): Promise<GameStats[]> {
  return invoke<GameStats[]>("get_game_stats");
}

/** Comprueba qué juegos tienen guardados nuevos sin subir */
export async function syncCheckUnsyncedGames(): Promise<UnsyncedGame[]> {
  return invoke<UnsyncedGame[]>("sync_check_unsynced_games");
}

/** Descarga los guardados de un juego desde la nube */
export async function syncDownloadGame(gameId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("sync_download_game", { gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Descarga los guardados de todos los juegos desde la nube (operación batch). */
export async function syncDownloadAllGames(): Promise<GameSyncResult[]> {
  const list = await invoke<{ gameId: string; result: SyncResult }[]>("sync_download_all_games");
  return list.map(({ gameId, result }) => ({
    gameId,
    result: {
      okCount: result.okCount,
      errCount: result.errCount,
      errors: result.errors,
    },
  }));
}

/** Snapshot de descargas activas para rehidratar la UI al iniciar. */
export async function getActiveDownloadsState(): Promise<ActiveDownloadState[]> {
  return invoke<ActiveDownloadState[]>("get_active_downloads_state");
}

/** Información de un backup local */
export interface BackupInfo {
  id: string;
  createdAt: string;
  fileCount: number;
}

/** Lista los backups locales de un juego */
export async function listBackups(gameId: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups", { gameId });
}

/** Restaura un backup local sobre los guardados del juego */
export async function restoreBackup(gameId: string, backupId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("restore_backup", { gameId, backupId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Información de un backup completo en la nube (un .tar por juego) */
export interface CloudBackupInfo {
  key: string;
  lastModified: string;
  size?: number;
  filename: string;
}

/** Crea un .tar de la carpeta del juego y lo sube a la nube (recomendado para juegos grandes). */
export async function createAndUploadFullBackup(gameId: string): Promise<string> {
  return invoke<string>("create_and_upload_full_backup", { gameId });
}

/** Lista los backups completos en la nube para un juego. */
export async function listFullBackups(gameId: string): Promise<CloudBackupInfo[]> {
  return invoke<CloudBackupInfo[]>("list_full_backups", { gameId });
}

/** Lista los backups en la nube para varios juegos en una sola invocación. */
export async function listFullBackupsBatch(gameIds: string[]): Promise<Record<string, CloudBackupInfo[]>> {
  const ids = gameIds.filter((id) => id?.trim());
  if (!ids.length) return {};
  return invoke<Record<string, CloudBackupInfo[]>>("list_full_backups_batch", {
    gameIds: ids,
  });
}

/** Descarga un backup completo por key y lo extrae en la carpeta del juego. */
export async function downloadAndRestoreFullBackup(gameId: string, backupKey: string): Promise<void> {
  await invoke("download_and_restore_full_backup", {
    gameId,
    backupKey,
  });
}

/** Elimina un backup empaquetado de la nube por key. */
export async function deleteFullBackup(gameId: string, backupKey: string): Promise<void> {
  await invoke("delete_cloud_backup", { gameId, backupKey });
}

/** Renombra un backup empaquetado en la nube. newFilename debe ser solo el nombre .tar (ej. "mi-backup.tar"). */
export async function renameFullBackup(gameId: string, backupKey: string, newFilename: string): Promise<void> {
  await invoke("rename_cloud_backup", {
    gameId,
    backupKey,
    newFilename,
  });
}

/** Resultado de la limpieza de backups antiguos */
export interface CleanupBackupsResult {
  backupsDeleted: number;
  gamesAffected: number;
}

/** Elimina backups antiguos: mantiene solo los últimos N por juego. Devuelve cuántos se borraron. */
export async function cleanupOldBackups(keepLastN: number): Promise<CleanupBackupsResult> {
  return invoke<CleanupBackupsResult>("cleanup_old_backups", {
    keepLastN,
  });
}

/** Guarda en config cuántos backups locales mantener por juego (usado por la UI y por la auto-limpieza). */
export async function setKeepBackupsPerGame(keepLastN: number): Promise<void> {
  await invoke("set_keep_backups_per_game", { keepLastN });
}

/** Experimental: activa/desactiva backup completo en streaming (sin .tar temporal). */
export async function setFullBackupStreaming(enabled: boolean): Promise<void> {
  await invoke("set_full_backup_streaming", { enabled });
}

/** Modo prueba: backup streaming sin subir a la nube. */
export async function setFullBackupStreamingDryRun(enabled: boolean): Promise<void> {
  await invoke("set_full_backup_streaming_dry_run", { enabled });
}

/** Nivel Zstd (1–22) para backup completo empaquetado en streaming; `null` restaura el predeterminado (5). */
export async function setFullBackupPackagedCompressionLevel(level: number | null): Promise<void> {
  await invoke("set_full_backup_packaged_compression_level", { level });
}

/** Modo desarrollador del perfil activo (persistido en el `settings.json` de ese perfil). */
export async function setDeveloperMode(enabled: boolean): Promise<void> {
  await invoke("set_developer_mode", { enabled });
}

/** Modo bajo rendimiento para reducir animaciones y uso de CPU/GPU en PCs lentas. */
export async function setLowPerformanceMode(enabled: boolean): Promise<void> {
  await invoke("set_low_performance_mode", { enabled });
}

/** Guarda la URL del proxy HTTP/HTTPS/SOCKS5 en la configuración. */
export async function setProxyUrl(proxyUrl: string | null): Promise<void> {
  await invoke("set_proxy_url", { proxyUrl });
}

/** Elimina todos los backups locales (carpeta SaveCloud/backups completa). */
export async function deleteAllLocalBackups(): Promise<void> {
  await invoke("delete_all_local_backups");
}

/** Archivo en la previsualización */
export interface PreviewFile {
  filename: string;
  size: number;
  localNewer?: boolean;
}

/** Previsualización de subida */
export interface PreviewUpload {
  fileCount: number;
  totalSizeBytes: number;
  files: PreviewFile[];
}

/** Previsualización de descarga */
export interface PreviewDownload {
  fileCount: number;
  totalSizeBytes: number;
  files: PreviewFile[];
  conflictCount: number;
}

/** Previsualiza qué archivos se subirían */
export async function previewUpload(gameId: string): Promise<PreviewUpload> {
  return invoke<PreviewUpload>("preview_upload", { gameId });
}

/** Previsualiza qué archivos se subirían para varios juegos en lote (batch) */
export async function previewUploadBatch(gameIds: string[]): Promise<Record<string, PreviewUpload>> {
  if (gameIds.length === 0) return {};
  return invoke<Record<string, PreviewUpload>>("preview_upload_batch", { gameIds });
}

/** Previsualiza qué archivos se descargarían */
export async function previewDownload(gameId: string): Promise<PreviewDownload> {
  return invoke<PreviewDownload>("preview_download", { gameId });
}

/** Inicia la descarga de un torrent */
export async function startTorrentDownload(magnet: string, savePath: string): Promise<string> {
  return invoke<string>("start_torrent_download", { magnet, savePath });
}

/** Inicia la descarga de un torrent a partir de un archivo .torrent */
export async function startTorrentFileDownload(filePath: string, savePath: string): Promise<string> {
  return invoke<string>("start_torrent_file_download", { filePath, savePath });
}

/** Cancela la descarga de un torrent */
export async function cancelTorrent(infoHash: string): Promise<void> {
  await invoke("cancel_torrent", { infoHash });
}

/** Pausa la descarga de un torrent */
export async function pauseTorrent(infoHash: string): Promise<void> {
  await invoke("pause_torrent", { infoHash });
}

/** Reanuda la descarga de un torrent pausado */
export async function resumeTorrent(infoHash: string): Promise<void> {
  await invoke("resume_torrent", { infoHash });
}

/** Lista infoHash de torrents activos para rehidratación. */
export async function getActiveTorrentDownloads(): Promise<string[]> {
  return invoke<string[]>("get_active_torrent_downloads");
}

/** Información de un archivo .torrent en la nube */
export interface CloudTorrentInfo {
  gameId: string;
  key: string;
  filename: string;
  lastModified: string;
  size?: number;
}

/** Sube un archivo .torrent a la nube asociado a un juego */
export async function uploadTorrentToCloud(gameId: string, torrentPath: string): Promise<void> {
  await invoke("upload_torrent_to_cloud", { gameId, torrentPath });
}

/** Lista los archivos .torrent almacenados en la nube para un juego */
export async function listCloudTorrents(gameId: string): Promise<CloudTorrentInfo[]> {
  return invoke<CloudTorrentInfo[]>("list_cloud_torrents", { gameId });
}

/** Descarga un .torrent desde la nube e inicia la descarga P2P del contenido */
export async function downloadTorrentFromCloud(gameId: string, torrentKey: string, savePath: string): Promise<string> {
  return invoke<string>("download_torrent_from_cloud", { gameId, torrentKey, savePath });
}

/** Elimina un .torrent almacenado en la nube */
export async function deleteCloudTorrent(gameId: string, torrentKey: string): Promise<void> {
  await invoke("delete_cloud_torrent", { gameId, torrentKey });
}

/** Obtiene los nombres de los juegos de Steam en batch. */
export async function getSteamAppNamesBatch(appIds: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_steam_app_names_batch", { appIds });
}

/** Exporta el SDK de plugins. */
export async function exportPluginSdk(): Promise<string> {
  return invoke<string>("export_plugin_sdk");
}

/** Obtiene los logs de los plugins. */
export async function getPluginLogs(): Promise<PluginLogEntry[]> {
  return invoke<PluginLogEntry[]>("get_plugin_logs");
}

/** Activa o desactiva modo juego (mitigaciones SaveCloud + ajustes de SO donde aplique). */
export async function gameModeSetEnabled(enabled: boolean): Promise<void> {
  await invoke("game_mode_set_enabled", { enabled });
}

/** Reaplica la configuración vigente cuando el modo ya está activo (tras cambiar opciones). */
export async function gameModeRefresh(): Promise<void> {
  await invoke("game_mode_refresh");
}

export async function setGameModeApplyPowerProfile(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_apply_power_profile", { enabled });
}

export async function setGameModeReduceCaptureOverhead(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_reduce_capture_overhead", { enabled });
}

export async function setGameModeThrottleSavecloudBackground(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_throttle_savecloud_background", { enabled });
}

export async function setGameModeBoostDetectedGameCpu(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_boost_detected_game_cpu", { enabled });
}

export async function setAutoExtractDownloads(enabled: boolean): Promise<void> {
  await invoke("set_auto_extract_downloads", { enabled });
}
