import { useConfig } from "./useConfig";

/**
 * Hook centralizado para verificar si el modo bajo rendimiento está habilitado.
 * Devuelve un booleano reactivo.
 */
export function useLowPerformanceMode(): boolean {
  const { config } = useConfig();
  return !!config?.lowPerformanceMode;
}
