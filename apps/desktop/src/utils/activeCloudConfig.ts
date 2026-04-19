import type { Config } from "@app-types/config";
import type { ActiveProfileSession } from "@store/ProfileSessionStore";

/**
 * Devuelve una vista de Config alineada con el perfil activo de sesión.
 * Mantiene fallback a `config` cuando el perfil aún no está hidratado.
 */
export function buildActiveCloudConfig(
  config: Config | null | undefined,
  activeProfile: ActiveProfileSession | null | undefined
): Config | null {
  if (config == null) return null;

  return {
    ...config,
    userId: activeProfile?.localUserId || config.userId,
    apiBaseUrl: activeProfile?.apiBaseUrl || config.apiBaseUrl,
    wsBaseUrl: activeProfile?.wsBaseUrl || config.wsBaseUrl,
  };
}
