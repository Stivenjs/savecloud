import { invoke } from "@tauri-apps/api/core";
import type { PathCandidate } from "@savecloud/types";
import type { GameSaveGraph } from "@app-types/saveGraph";
import { dedupePreserveGamePaths } from "@utils/gameSavePaths";

export type { PathCandidate };

/** Proceso visible en el selector manual (nombre como en el Administrador de tareas + icono del .exe en Windows). */
export interface RunningProcessPickRow {
  name: string;
  iconPngBase64?: string | null;
}

/** Estadísticas por juego (tamaño local, últimas modificaciones) */
export interface GameStats {
  gameId: string;
  localSizeBytes: number;
  localLastModified: string | null;
  cloudLastModified: string | null;
  playtimeSeconds: number;
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

/** Elimina un juego (o una ruta concreta) de la configuración */
export async function removeGame(gameId: string, path?: string): Promise<void> {
  await invoke("remove_game", { gameId, path });
}

/** Renombra un juego en la configuración local (cambia su id) */
export async function renameGame(oldGameId: string, newGameId: string): Promise<void> {
  await invoke("rename_game", { oldGameId, newGameId });
}

/** Abre la carpeta de guardados del juego en el explorador */
export async function openSaveFolder(gameId: string): Promise<void> {
  await invoke("open_save_folder", { gameId });
}

/** Lee un archivo de imagen y devuelve su data URL (base64). Para portadas personalizadas. */
export async function readImageAsDataUrl(path: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { path });
}

/** Escanea el sistema en busca de carpetas candidatas para guardados */
export async function scanPathCandidates(): Promise<PathCandidate[]> {
  return invoke<PathCandidate[]>("scan_path_candidates");
}

/** Obtiene estadísticas de todos los juegos configurados */
export async function getGameStats(): Promise<GameStats[]> {
  return invoke<GameStats[]>("get_game_stats");
}

/** Devuelve el mapa visual de guardados de un juego concreto. */
export async function getGameSaveGraph(gameId: string): Promise<GameSaveGraph> {
  return invoke<GameSaveGraph>("get_game_save_graph", { gameId });
}
