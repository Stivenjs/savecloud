import type { AppSettingsConfig } from "@app-types/config";
import type { ActiveProfileSession } from "@store/ProfileSessionStore";

/**
 * Devuelve una vista de ajustes alineada con el perfil activo de sesión.
 * Mantiene fallback a `config` cuando el perfil aún no está hidratado.
 */
export function buildActiveCloudConfig(
  config: AppSettingsConfig | null | undefined,
  activeProfile: ActiveProfileSession | null | undefined
): AppSettingsConfig | null {
  if (config == null) return null;

  return {
    ...config,
    userId: activeProfile?.localUserId || config.userId,
    apiBaseUrl: activeProfile?.apiBaseUrl || config.apiBaseUrl,
    wsBaseUrl: activeProfile?.wsBaseUrl || config.wsBaseUrl,
  };
}
