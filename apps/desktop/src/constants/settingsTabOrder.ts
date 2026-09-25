import type { SettingsTabKey } from "@features/settings/SettingsSidebar";
import { SETTINGS_SIDEBAR_SECTIONS } from "@/constants/settingsSidebarSections";

/** Orden vertical del sidebar (mismo orden que las secciones y sus ítems). */
export const SETTINGS_TAB_ORDER: readonly SettingsTabKey[] = SETTINGS_SIDEBAR_SECTIONS.flatMap((s) => [...s.tabKeys]);
