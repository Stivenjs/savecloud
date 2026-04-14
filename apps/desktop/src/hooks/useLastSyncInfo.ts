import { useMemo } from "react";
import { useQuery, type Query } from "@tanstack/react-query";
import { syncListRemoteSavesSummary } from "@services/tauri";

export const LAST_SYNC_QUERY_KEY = ["last-sync-info"] as const;
const CONFIG_GAME_ID = "__config__";

export interface LastSyncInfo {
  lastSyncAt: Date | null;
  lastSyncGameId: string | null;
}

export interface CloudGameSummary {
  gameId: string;
  fileCount: number;
  totalSize: number;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "retrying";

type LastSyncQueryData = {
  lastSyncAt: Date | null;
  lastSyncGameId: string | null;
  cloudGames: CloudGameSummary[];
  totalCloudSize: number;
};

function computeLastSync(saves: { gameId: string; lastModified: string | null }[]): LastSyncInfo {
  if (saves.length === 0) {
    return { lastSyncAt: null, lastSyncGameId: null };
  }

  let latest: { gameId: string; date: Date } | null = null;

  for (const s of saves) {
    if (!s.lastModified) continue;
    const date = new Date(s.lastModified);
    if (!latest || date > latest.date) {
      latest = { gameId: s.gameId, date };
    }
  }

  return {
    lastSyncAt: latest?.date ?? null,
    lastSyncGameId: latest?.gameId ?? null,
  };
}

function computeCloudGames(saves: { gameId: string; totalSizeBytes: number; fileCount: number }[]): {
  cloudGames: CloudGameSummary[];
  totalSize: number;
} {
  const cloudGames: CloudGameSummary[] = saves.map((s) => ({
    gameId: s.gameId,
    fileCount: s.fileCount,
    totalSize: s.totalSizeBytes,
  }));

  const totalSize = cloudGames.reduce((sum, g) => sum + g.totalSize, 0);

  return { cloudGames, totalSize };
}

export function useLastSyncInfo(enabled: boolean) {
  const query = useQuery<LastSyncQueryData, Error>({
    queryKey: LAST_SYNC_QUERY_KEY,

    queryFn: async (): Promise<LastSyncQueryData> => {
      const all = await syncListRemoteSavesSummary();
      const saves = all.filter((s) => s.gameId !== CONFIG_GAME_ID);

      const lastSync = computeLastSync(saves);
      const { cloudGames, totalSize } = computeCloudGames(saves);

      return {
        ...lastSync,
        cloudGames,
        totalCloudSize: totalSize,
      };
    },

    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,

    refetchInterval: (query: Query<LastSyncQueryData, Error>) => (query.state.status === "error" ? 30_000 : false),
    retry: 2,
  });

  const processedData = useMemo(() => {
    return {
      lastSyncAt: query.data?.lastSyncAt ?? null,
      lastSyncGameId: query.data?.lastSyncGameId ?? null,
      cloudGames: query.data?.cloudGames ?? [],
      totalCloudSize: query.data?.totalCloudSize ?? 0,
    };
  }, [query.data]);

  const connectionStatus = useMemo((): ConnectionStatus => {
    if (!enabled) return "idle";

    if (query.isError) {
      return query.isFetching ? "retrying" : "error";
    }

    if (query.isLoading) return "connecting";

    return "connected";
  }, [enabled, query.isError, query.isFetching, query.isLoading]);

  return {
    ...processedData,
    isLoading: query.isLoading && enabled,
    isFetching: query.isFetching,
    connectionStatus,
    connectionError: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
