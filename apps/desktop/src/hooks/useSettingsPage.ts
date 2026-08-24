import { useConfigManagement } from "@features/settings/hooks/useConfigManagement";
import { useSteamCatalogSettings } from "@features/settings/hooks/useSteamCatalogSettings";
import { useSourcesSettings } from "@features/settings/hooks/useSourcesSettings";
import { useSystemPreferenceSettings } from "@features/settings/hooks/useSystemPreferenceSettings";

/**
 * Hook compositor para la página de Ajustes.
 * Ensambla los sub-hooks especializados por dominio preservando la misma API unificada.
 */
export function useSettingsPage() {
  const configMgmt = useConfigManagement();
  const steamCatalog = useSteamCatalogSettings();
  const sources = useSourcesSettings();
  const sysPrefs = useSystemPreferenceSettings();

  return {
    ...configMgmt,
    ...steamCatalog,
    ...sources,
    ...sysPrefs,
  };
}
