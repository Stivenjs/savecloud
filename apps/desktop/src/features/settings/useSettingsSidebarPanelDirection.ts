import { useRef } from "react";
import type { SettingsTabKey } from "@features/settings/SettingsSidebar";
import { SETTINGS_TAB_ORDER } from "@/constants/settingsTabOrder";

/**
 * Dirección de la última navegación entre pestañas del sidebar (índice en lista).
 * +1: se eligió una opción más abajo (el contenido nuevo entra desde abajo).
 * -1: se eligió una opción más arriba (el contenido nuevo entra desde arriba).
 * 0: sin cambio de pestaña en este ciclo de render (o mismo índice).
 *
 * El valor se conserva entre renders mientras la pestaña no cambie, para que
 * AnimatePresence pueda completar salidas con la dirección correcta.
 */
export function useSettingsSidebarPanelDirection(activeTab: SettingsTabKey): number {
  const prevTabRef = useRef<SettingsTabKey>(activeTab);
  const directionRef = useRef(0);

  if (prevTabRef.current !== activeTab) {
    const from = SETTINGS_TAB_ORDER.indexOf(prevTabRef.current);
    const to = SETTINGS_TAB_ORDER.indexOf(activeTab);
    directionRef.current = to > from ? 1 : to < from ? -1 : 0;
    prevTabRef.current = activeTab;
  }

  return directionRef.current;
}
