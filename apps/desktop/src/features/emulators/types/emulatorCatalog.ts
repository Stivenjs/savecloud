import type { EmulatorProgressPayload, EmulatorStatus } from "@services/tauri/emulators.service";

export interface EmulatorCatalogEntry {
  id: string;
  name: string;
  console: string;
  developer: string;
  description: { es: string; en: string };
  imageUrl: string;
  websiteUrl: string;
  downloadUrl: string;
  supportedPlatforms: string[];
  license: string;
  saveSyncSupported: boolean;
  managedInstall: boolean;
}

export type EmulatorStatuses = Record<string, EmulatorStatus>;
export type EmulatorProgressById = Record<string, EmulatorProgressPayload>;
