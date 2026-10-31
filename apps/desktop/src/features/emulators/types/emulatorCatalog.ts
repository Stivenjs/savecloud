import type { EmulatorProgressPayload, EmulatorStatus } from "@services/tauri/emulators.service";

export type EmulatorPlatform = "windows" | "macos" | "linux";

export interface EmulatorLaunchRule {
  extensions: string[];
  arguments: string[];
}

export interface EmulatorCatalogEntry {
  id: string;
  name: string;
  console: string;
  developer: string;
  description: { es: string; en: string };
  imageUrl: string;
  websiteUrl: string;
  downloadUrl: string;
  releaseAssets: Partial<Record<EmulatorPlatform, EmulatorReleaseAssetSource>>;
  executableNames: string[];
  executableSearchPaths: Partial<Record<EmulatorPlatform, string[]>>;
  savePaths: Partial<Record<EmulatorPlatform, string[]>>;
  portableSavePath?: string;
  launchRules: EmulatorLaunchRule[];
  supportedPlatforms: string[];
  license: string;
  saveSyncSupported: boolean;
  managedInstall: boolean;
}

export interface EmulatorReleaseAssetSource {
  apiUrl: string;
  nameIncludes: string[];
  extension: string;
  artifactType: string;
}

export type EmulatorStatuses = Record<string, EmulatorStatus>;
export type EmulatorProgressById = Record<string, EmulatorProgressPayload>;
