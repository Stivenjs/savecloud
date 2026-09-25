import { useMemo, useCallback } from "react";
import { useConfig, CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import { useQueryClient } from "@tanstack/react-query";
import { useGamesFiltering } from "@features/games/hooks/useGamesFiltering";
import { filterGames } from "@features/games/GamesFilters";
import { useGamesModals } from "@features/games/hooks/useGamesModals";
import { useGamesSyncActions } from "@features/games/hooks/useGamesSyncActions";
import { useLibraryPage } from "@hooks/useLibraryPage";
import type { ConfiguredGame } from "@savecloud/types";

export type { OperationResult } from "@features/games/hooks/useGamesSyncActions";

/**
 * Hook compositor para la página de Juegos.
 * Ensambla los sub-hooks especializados (filtros, modales, sync/acciones) preservando la API completa.
 */
export function useGamesPage() {
  const queryClient = useQueryClient();
  const { config, loading, error, refetch } = useConfig();
  const { activeProfile } = useProfileSession();
  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);
  const hasSyncConfig = hasUsableCloudConnection(cloudConfig);
  const {
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    isLoading: lastSyncLoading,
    connectionStatus,
    connectionError,
    refetch: refetchLastSync,
  } = useLastSyncInfo(hasSyncConfig);

  const invalidateConfig = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    refetch?.();
  }, [queryClient, refetch]);

  const filtering = useGamesFiltering([], cloudGames.length);
  const libraryPage = useLibraryPage(filtering.debouncedSearchTerm);
  const libraryGames = useMemo(
    () => filterGames(libraryPage.games, "", filtering.originFilter),
    [libraryPage.games, filtering.originFilter]
  );
  const libraryConfig = useMemo(
    () => (config ? { ...config, games: libraryPage.games } : null),
    [config, libraryPage.games]
  );
  const emptyFilterMessage =
    libraryPage.total > 0 &&
    (filtering.debouncedSearchTerm !== "" || filtering.originFilter !== "all") &&
    libraryGames.length === 0
      ? "No se encontraron juegos con los filtros aplicados."
      : libraryPage.total === 0 && cloudGames.length > 0
        ? "No hay juegos configurados, pero tienes guardados en la nube. Añade de nuevo cada juego con el mismo identificador y la ruta local para poder descargar sus backups."
        : undefined;

  const modals = useGamesModals({
    gamesCount: libraryPage.total,
    onRefresh: () => syncActions.handleRefresh(),
    onInvalidateConfig: invalidateConfig,
  });

  const setSyncPreview = useCallback(
    (game: ConfiguredGame | null, type: "upload" | "download" | null) => {
      modals.setSyncPreviewGame(game);
      modals.setSyncPreviewType(type);
    },
    [modals]
  );

  const syncActions = useGamesSyncActions({
    config,
    hasSyncConfig,
    refetchConfig: refetch,
    refetchLastSync,
    syncPreviewGame: modals.syncPreviewGame,
    syncPreviewType: modals.syncPreviewType,
    setSyncPreview,
    bulkConfirm: modals.bulkConfirm,
    setBulkConfirm: modals.setBulkConfirm,
  });

  return {
    config: libraryConfig,
    loading: loading || libraryPage.loading,
    error: error ?? libraryPage.error,
    refetch: libraryPage.refetch,
    hasSyncConfig,
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    lastSyncLoading,
    connectionStatus,
    connectionError,
    refetchLastSync,
    ...filtering,
    filteredGames: libraryGames,
    emptyFilterMessage,
    loadMoreLibrary: libraryPage.loadMore,
    hasMoreLibrary: libraryPage.hasMore,
    loadingMoreLibrary: libraryPage.loadingMore,
    ...modals,
    ...syncActions,
  };
}
