import type { Config } from "@app-types/config";

/**
 * Verifica si la configuración tiene una conexión cloud válida y utilizable.
 *
 * Una conexión cloud es válida si:
 * - Existe un userId configurado, Y
 * - Tiene su propia conexión cloud (apiBaseUrl + apiKey) O está usando la conexión de un host
 *
 * @param config - Configuración de la aplicación (puede ser null o undefined)
 * @returns `true` si hay una conexión cloud utilizable, `false` en caso contrario
 *
 * @example
 * // Con conexión propia
 * hasUsableCloudConnection({
 *   userId: "user123",
 *   apiBaseUrl: "https://api.example.com",
 *   apiKey: "abc123"
 * }); // true
 *
 * @example
 * // Con conexión de host
 * hasUsableCloudConnection({
 *   userId: "user123",
 *   activeCloudHostUserId: "host456"
 * }); // true
 *
 * @example
 * // Sin conexión válida
 * hasUsableCloudConnection({
 *   userId: "user123"
 * }); // false
 */
export function hasUsableCloudConnection(config: Config | null | undefined): boolean {
  const hasUser = !!config?.userId?.trim();
  if (!hasUser) return false;

  const hasOwnConnection = !!(config?.apiBaseUrl?.trim() && config?.apiKey?.trim());

  const hasActiveHostConnection = !!config?.activeCloudHostUserId?.trim();

  return hasOwnConnection || hasActiveHostConnection;
}
