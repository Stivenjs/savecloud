import { invoke } from "@tauri-apps/api/core";

export interface InventoryFileEntry {
  relativePath: string;
  size: number;
  hash: string;
}

export interface GameInventoryEntry {
  gameKey: string;
  displayName: string;
  status: string;
  payloadKind: string;
  totalBytes: number;
  fileCount: number;
  manifestHash: string;
  verifiedAt: string;
  files: InventoryFileEntry[];
}

export interface DeviceInventoryManifest {
  deviceId: string;
  deviceName: string;
  userId: string;
  manifestVersion: number;
  contentHash: string;
  updatedAt: string;
  sharingEnabled: boolean;
  games: GameInventoryEntry[];
}

export interface GameProviderDevice {
  userId: string;
  deviceId: string;
  deviceName: string;
  totalBytes: number;
  payloadKind: string;
  manifestHash: string;
  verifiedAt: string;
  lastSeenAt?: string | null;
  files?: InventoryFileEntry[];
}

export interface GameProvidersResponse {
  gameKey: string;
  providers: GameProviderDevice[];
}

export interface LanDeviceProbe {
  deviceId: string;
  userId: string;
  lanHost: string;
  port: number;
  reachable: boolean;
}

export interface PeerInstallOffer {
  userId: string;
  deviceId: string;
  deviceName: string;
  totalBytes: number;
  payloadKind: string;
  manifestHash: string;
  reachableOnLan: boolean;
}

export function inventoryGameKeyFromSteamAppId(steamAppId: string): Promise<string | null> {
  return invoke<string | null>("inventory_game_key_from_steam_app_id", { steamAppId });
}

export function inventoryListProviders(gameKey: string): Promise<GameProvidersResponse> {
  return invoke<GameProvidersResponse>("inventory_list_providers", { gameKey });
}

export function inventoryProbeLan(deviceIds: string[]): Promise<LanDeviceProbe[]> {
  return invoke<LanDeviceProbe[]>("inventory_probe_lan", { deviceIds });
}

export function inventoryScanAndPublish(forceScan = true): Promise<DeviceInventoryManifest> {
  return invoke<DeviceInventoryManifest>("inventory_scan_and_publish", { forceScan });
}

export function inventoryRegisterInstallFolder(
  steamAppId: string,
  displayName: string,
  folderPath: string
): Promise<DeviceInventoryManifest> {
  return invoke<DeviceInventoryManifest>("inventory_register_install_folder", {
    steamAppId,
    displayName,
    folderPath,
  });
}

export function inventoryGetLocal(): Promise<{ manifest: DeviceInventoryManifest | null }> {
  return invoke<{ manifest: DeviceInventoryManifest | null }>("inventory_get_local");
}

export function startPeerGameDownload(params: {
  gameKey: string;
  title: string;
  destinationDir: string;
  targetUserId: string;
  targetDeviceId: string;
  manifestHash: string;
}): Promise<string> {
  return invoke<string>("start_peer_game_download", params);
}

export function setShareGameInventoryWithCloud(enabled: boolean): Promise<void> {
  return invoke<void>("set_share_game_inventory_with_cloud", { enabled });
}

export async function resolvePeerInstallOffers(steamAppId: string | null | undefined): Promise<{
  gameKey: string | null;
  offers: PeerInstallOffer[];
}> {
  if (!steamAppId?.trim()) {
    return { gameKey: null, offers: [] };
  }

  const gameKey = await inventoryGameKeyFromSteamAppId(steamAppId);
  if (!gameKey) {
    return { gameKey: null, offers: [] };
  }

  const [providersRes, _] = await Promise.all([inventoryListProviders(gameKey), Promise.resolve(null)]);

  const deviceIds = providersRes.providers.map((p) => p.deviceId);
  const lanProbes = deviceIds.length > 0 ? await inventoryProbeLan(deviceIds) : [];
  const probeByDevice = new Map(lanProbes.map((p) => [p.deviceId, p]));

  const offers: PeerInstallOffer[] = providersRes.providers.map((p) => ({
    userId: p.userId,
    deviceId: p.deviceId,
    deviceName: p.deviceName,
    totalBytes: p.totalBytes,
    payloadKind: p.payloadKind,
    manifestHash: p.manifestHash,
    reachableOnLan: probeByDevice.get(p.deviceId)?.reachable ?? false,
  }));

  return { gameKey, offers };
}
