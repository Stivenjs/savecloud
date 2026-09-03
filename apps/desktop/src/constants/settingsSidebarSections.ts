import type { SettingsTabKey } from "@features/settings/SettingsSidebar";

/**
 * Agrupación del panel lateral (orden dentro de cada grupo = orden en la lista).
 * Debe incluir todas las claves de {@link SettingsTabKey} exactamente una vez.
 */
export const SETTINGS_SIDEBAR_SECTIONS: ReadonlyArray<{
  title: string;
  tabKeys: readonly SettingsTabKey[];
}> = [
  { title: "Cuenta y datos", tabKeys: ["account", "cloud"] },
  { title: "Aplicación", tabKeys: ["app", "big-picture"] },
  { title: "Dispositivos e integraciones", tabKeys: ["sources", "integrations", "gamepad", "plugins"] },
  { title: "Sistema", tabKeys: ["updates", "advanced"] },
];
