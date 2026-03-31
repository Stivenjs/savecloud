import type { Config } from "@app-types/config";

export function hasUsableCloudConnection(config: Config | null | undefined): boolean {
  const hasUser = !!config?.userId?.trim();
  if (!hasUser) return false;

  const hasOwnConnection = !!(config?.apiBaseUrl?.trim() && config?.apiKey?.trim());
  const hasActiveHostConnection = !!config?.activeCloudHostUserId?.trim();

  return hasOwnConnection || hasActiveHostConnection;
}
