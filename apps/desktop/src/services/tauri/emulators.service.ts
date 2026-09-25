import { invoke } from "@tauri-apps/api/core";

export interface EmulatorStatus {
  name: string;
  installed: boolean;
  path: string | null;
}

export interface EmulatorProgressPayload {
  emulator: string;
  status: "downloading" | "extracting" | "finished" | "failed";
  loaded: number;
  total: number;
  speed?: number | null;
  eta?: number | null;
  error?: string | null;
}

export function detectEmulators(): Promise<Record<string, EmulatorStatus>> {
  return invoke<Record<string, EmulatorStatus>>("detect_emulators");
}

export function setEmulatorPath(emulator: string, path: string): Promise<void> {
  return invoke("set_emulator_path", { emulator, path });
}

export function downloadEmulator(emulator: string): Promise<void> {
  return invoke("download_emulator", { emulator });
}
