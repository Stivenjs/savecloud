import { invoke } from "@tauri-apps/api/core";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  apiVersion: number;
  folderName: string;
  folderPath: string;
  preUploadTimeoutMs: number;
  loaded: boolean;
  error?: string;
  storageKeysCount: number;
}

export interface PluginStorageEntry {
  key: string;
  value: string;
  updatedAt: number;
}

export async function getInstalledPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("get_installed_plugins");
}

export async function togglePluginEnabled(folderName: string, enabled: boolean): Promise<PluginInfo> {
  return invoke<PluginInfo>("toggle_plugin_enabled", { folderName, enabled });
}

export async function reloadPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("reload_plugins");
}

export async function openPluginsFolder(): Promise<void> {
  return invoke<void>("open_plugins_folder");
}

export async function openPluginFolder(folderName: string): Promise<void> {
  return invoke<void>("open_plugin_folder", { folderName });
}

export async function deletePlugin(folderName: string, clearStorage: boolean): Promise<void> {
  return invoke<void>("delete_plugin", { folderName, clearStorage });
}

export async function getPluginStorage(pluginId: string): Promise<PluginStorageEntry[]> {
  return invoke<PluginStorageEntry[]>("get_plugin_storage", { pluginId });
}

export async function clearPluginStorage(pluginId: string): Promise<void> {
  return invoke<void>("clear_plugin_storage", { pluginId });
}
