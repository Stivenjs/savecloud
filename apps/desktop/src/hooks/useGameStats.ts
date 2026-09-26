import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGameStats } from "@services/tauri";
import type { GameStats } from "@services/tauri";
import { useProfileSession } from "@hooks/useProfileSession";

const GAME_STATS_QUERY_KEY = ["game-stats"] as const;
const GAME_STATS_CACHE_VERSION = 1;

interface PersistedGameStats {
  version: number;
  savedAt: number;
  data: GameStats[];
}

function isGameStats(value: unknown): value is GameStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<GameStats>;
  return (
    typeof stats.gameId === "string" &&
    typeof stats.localSizeBytes === "number" &&
    (typeof stats.localLastModified === "string" || stats.localLastModified === null) &&
    (typeof stats.cloudLastModified === "string" || stats.cloudLastModified === null) &&
    typeof stats.playtimeSeconds === "number"
  );
}

function readPersistedGameStats(storageKey: string): PersistedGameStats | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;

    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;

    const cache = value as Partial<PersistedGameStats>;
    if (
      cache.version !== GAME_STATS_CACHE_VERSION ||
      typeof cache.savedAt !== "number" ||
      !Array.isArray(cache.data) ||
      !cache.data.every(isGameStats)
    ) {
      return undefined;
    }

    return cache as PersistedGameStats;
  } catch {
    return undefined;
  }
}

export function useGameStats(enabled: boolean) {
  const { activeProfile } = useProfileSession();
  const profileId = activeProfile?.id ?? "default";
  const storageKey = `savecloud.game-stats.v${GAME_STATS_CACHE_VERSION}.${encodeURIComponent(profileId)}`;
  const persistedStats = useMemo(() => readPersistedGameStats(storageKey), [storageKey]);
  const query = useQuery({
    queryKey: [...GAME_STATS_QUERY_KEY, profileId],
    queryFn: getGameStats,
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    initialData: persistedStats?.data,
    initialDataUpdatedAt: persistedStats?.savedAt,
  });

  const statsByGameId = useMemo(() => {
    return new Map((query.data ?? []).map((s: GameStats) => [s.gameId, s]));
  }, [query.data]);

  useEffect(() => {
    if (!query.data || query.dataUpdatedAt === 0) return;

    try {
      const cache: PersistedGameStats = {
        version: GAME_STATS_CACHE_VERSION,
        savedAt: query.dataUpdatedAt,
        data: query.data,
      };
      localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // La caché es una optimización; si el almacenamiento no está disponible, se usa la consulta normal.
    }
  }, [query.data, query.dataUpdatedAt, storageKey]);

  return {
    statsByGameId,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
