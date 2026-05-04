import type { SettingsTabKey } from "@features/settings/SettingsSidebar";

/**
 * Orden vertical del sidebar de ajustes. Debe coincidir con {@link SETTINGS_TABS} en SettingsPage.
 */
export const SETTINGS_TAB_ORDER: readonly SettingsTabKey[] = [
  "account",
  "app",
  "big-picture",
  "integrations",
  "gamepad",
  "updates",
  "advanced",
];
