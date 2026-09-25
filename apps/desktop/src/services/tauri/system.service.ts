import { invoke } from "@tauri-apps/api/core";

export async function openWebviewDevtools(windowLabel: string): Promise<void> {
  await invoke("open_webview_devtools", { windowLabel });
}

export async function closeWebviewDevtools(windowLabel: string): Promise<void> {
  await invoke("close_webview_devtools", { windowLabel });
}

export interface DiskInfo {
  mountPoint: string;
  name: string;
  availableSpace: number;
  totalSpace: number;
  isRemovable: boolean;
}

export async function getAvailableDisks(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>("get_available_disks");
}
