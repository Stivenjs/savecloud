import { invoke } from "@tauri-apps/api/core";

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
