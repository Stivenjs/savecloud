import type { SettingsTabKey } from "@features/settings/SettingsSidebar";

export const SAVECLOUD_SETTINGS_SELECT_TAB_EVENT = "savecloud-settings-select-tab" as const;
export type SavecloudSettingsSelectTabPayload = { tab: SettingsTabKey };

export const SAVECLOUD_OPEN_RESTORE_FROM_CLOUD_EVENT = "savecloud-open-restore-from-cloud" as const;
export type SavecloudOpenRestoreFromCloudPayload = { gameId: string };

const VALID_SETTINGS_TAB_KEYS = new Set<SettingsTabKey>([
  "account",
  "cloud",
  "app",
  "big-picture",
  "sources",
  "integrations",
  "gamepad",
  "plugins",
  "updates",
  "advanced",
]);

/** Valida un valor de query `tab` / `settingsTab` para la ventana de ajustes. */
export function parseSettingsTabQueryValue(raw: string | null | undefined): SettingsTabKey | null {
  if (!raw) return null;
  const t = raw.trim() as SettingsTabKey;
  return VALID_SETTINGS_TAB_KEYS.has(t) ? t : null;
}
