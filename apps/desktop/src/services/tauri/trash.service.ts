/**
 * @fileoverview Servicio de interacción con los comandos de papelera de reciclaje en Rust / Tauri.
 *
 * @module services/tauri/trash.service
 */

import { invoke } from "@tauri-apps/api/core";
import type { TrashGameItem } from "@savecloud/types";

/**
 * Lista todos los juegos que se encuentran actualmente en la papelera de reciclaje.
 */
export async function listTrash(): Promise<TrashGameItem[]> {
  return invoke<TrashGameItem[]>("sync_list_trash");
}

/**
 * Restaura un juego desde la papelera de reciclaje a su ubicación activa en la nube.
 */
export async function restoreFromTrash(gameId: string): Promise<void> {
  await invoke("sync_restore_from_trash", { gameId });
}

/**
 * Elimina definitivamente un juego específico de la papelera de reciclaje.
 */
export async function deleteFromTrash(gameId: string): Promise<void> {
  await invoke("sync_delete_from_trash", { gameId });
}

/**
 * Vacía completamente toda la papelera de reciclaje del usuario.
 */
export async function emptyTrash(): Promise<void> {
  await invoke("sync_empty_trash");
}
