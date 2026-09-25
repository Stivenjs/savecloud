import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getConfig,
  getGameStats,
  listFullBackupsBatch,
  syncListRemoteSavesSummary,
  listOperationHistory,
} from "@services/tauri";
import { buildLibrarySaveGraphModel } from "@utils/saveGraph.mapper";

/**
 * Carga y compone el grafo general de la biblioteca.
 */
export function useLibrarySaveGraphData() {
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const gameIds = useMemo(() => configQuery.data?.games.map((game) => game.id) ?? [], [configQuery.data?.games]);

  const statsQuery = useQuery({
    queryKey: ["game-stats"],
    queryFn: getGameStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const historyQuery = useQuery({
    queryKey: ["operation-history"],
    queryFn: listOperationHistory,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const remoteSummaryQuery = useQuery({
    queryKey: ["remote-saves-summary"],
    queryFn: syncListRemoteSavesSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const fullBackupsQuery = useQuery({
    queryKey: ["full-backups-batch", gameIds],
    queryFn: () => listFullBackupsBatch(gameIds),
    enabled: gameIds.length > 0,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const model = useMemo(
    () =>
      buildLibrarySaveGraphModel({
        config: configQuery.data ?? null,
        stats: statsQuery.data ?? [],
        history: historyQuery.data ?? [],
        remoteSummary: remoteSummaryQuery.data ?? [],
        fullBackupsByGame: fullBackupsQuery.data ?? {},
      }),
    [configQuery.data, fullBackupsQuery.data, historyQuery.data, remoteSummaryQuery.data, statsQuery.data]
  );

  return {
    configQuery,
    statsQuery,
    historyQuery,
    remoteSummaryQuery,
    fullBackupsQuery,
    model,
  };
}
