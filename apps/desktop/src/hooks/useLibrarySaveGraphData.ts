import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGameStats, listFullBackupsBatch, syncListRemoteSavesSummary, listOperationHistory } from "@services/tauri";
import { useLibrary } from "@hooks/useLibrary";
import { buildLibrarySaveGraphModel } from "@utils/saveGraph.mapper";

/**
 * Carga y compone el grafo general de la biblioteca.
 */
export function useLibrarySaveGraphData() {
  const { games, loading: libraryLoading, error: libraryError, refetch: refetchLibrary } = useLibrary();

  const gameIds = useMemo(() => games.map((game) => game.id), [games]);

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
        games,
        stats: statsQuery.data ?? [],
        history: historyQuery.data ?? [],
        remoteSummary: remoteSummaryQuery.data ?? [],
        fullBackupsByGame: fullBackupsQuery.data ?? {},
      }),
    [games, fullBackupsQuery.data, historyQuery.data, remoteSummaryQuery.data, statsQuery.data]
  );

  return {
    libraryQuery: { data: games, isLoading: libraryLoading, error: libraryError, refetch: refetchLibrary },
    statsQuery,
    historyQuery,
    remoteSummaryQuery,
    fullBackupsQuery,
    model,
  };
}
