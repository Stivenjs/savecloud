import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listFullBackupsBatch } from "@services/tauri";

const CLOUD_BACKUP_COUNTS_QUERY_KEY = ["cloud-backup-counts"] as const;

/**
 * Obtiene el número de backups completos (empaquetados) en la nube por juego.
 * Una sola petición batch para todos los gameIds.
 */
export function useCloudBackupCounts(gameIds: string[], enabled: boolean) {
  const sortedKey = useMemo(() => [...gameIds].filter(Boolean).sort().join(","), [gameIds]);

  const { data: backupsByGameId, isLoading } = useQuery({
    queryKey: [...CLOUD_BACKUP_COUNTS_QUERY_KEY, sortedKey],
    queryFn: () => listFullBackupsBatch(gameIds.filter((id) => !!id)),
    enabled: enabled && gameIds.filter(Boolean).length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const countByGameId = useMemo(() => {
    const out: Record<string, number> = {};
    if (!backupsByGameId) return out;
    for (const gameId of gameIds) {
      if (gameId) {
        out[gameId] = backupsByGameId[gameId]?.length ?? 0;
      }
    }
    return out;
  }, [gameIds, backupsByGameId]);

  return {
    countByGameId,
    isLoading,
  };
}
