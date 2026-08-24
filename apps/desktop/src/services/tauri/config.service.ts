import { invoke } from "@tauri-apps/api/core";
import type { Config } from "@savecloud/types";

// Re-exports de servicios modulares por dominio para mantener 100% de retrocompatibilidad
export * from "./games.service";
export * from "./steam.service";
export * from "./system-settings.service";
export * from "./backups.service";
export * from "./sync-cloud.service";
export * from "./torrent.service";
export * from "./plugins.service";

/** Obtiene la configuración desde el archivo compartido con el CLI */
export async function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

/** Ruta del archivo de configuración (para mostrar al usuario) */
export async function getConfigPath(): Promise<string> {
  return invoke<string>("get_config_path");
}

/**
 * Crea o actualiza el archivo de configuración con apiBaseUrl, apiKey y userId.
 * Opcionalmente la clave Steam Web API (se guarda en el almacén seguro del SO).
 * Devuelve la ruta del archivo.
 */
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

/** Exporta la configuración a un archivo JSON. Devuelve el path. */
export async function exportConfigToFile(path: string): Promise<string> {
  return invoke("export_config_to_file", { path });
}

/** Importa configuración desde archivo. mode: "merge" | "replace" */
export async function importConfigFromFile(path: string, mode: "merge" | "replace"): Promise<void> {
  await invoke("import_config_from_file", { path, mode });
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

/** Establece la URL del servidor WebSocket para un host específico. */
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
