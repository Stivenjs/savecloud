import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { syncListRemoteSaves } from "@services/tauri";

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

function computeLastSync(saves: { gameId: string; lastModified: string }[]): LastSyncInfo {
  if (saves.length === 0) return { lastSyncAt: null, lastSyncGameId: null };

  let latest: { gameId: string; date: Date } | null = null;

  for (const s of saves) {
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

function computeCloudGames(saves: { gameId: string; size?: number }[]): {
  cloudGames: CloudGameSummary[];
  totalSize: number;
} {
  const byGame = new Map<string, { count: number; size: number }>();

  for (const s of saves) {
    const existing = byGame.get(s.gameId) ?? { count: 0, size: 0 };
    byGame.set(s.gameId, {
      count: existing.count + 1,
      size: existing.size + (s.size ?? 0),
    });
  }

  const cloudGames: CloudGameSummary[] = Array.from(byGame.entries()).map(([gameId, { count, size }]) => ({
    gameId,
    fileCount: count,
    totalSize: size,
  }));

  const totalSize = cloudGames.reduce((sum, g) => sum + g.totalSize, 0);
  return { cloudGames, totalSize };
}

export function useLastSyncInfo(enabled: boolean) {
  const query = useQuery({
    queryKey: LAST_SYNC_QUERY_KEY,
    queryFn: async () => {
      const allSaves = await syncListRemoteSaves();
      const saves = allSaves.filter((s) => s.gameId !== CONFIG_GAME_ID);

      const lastSync = computeLastSync(saves);
      const { cloudGames, totalSize } = computeCloudGames(saves);

      return { ...lastSync, cloudGames, totalCloudSize: totalSize };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,

    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : false),
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
