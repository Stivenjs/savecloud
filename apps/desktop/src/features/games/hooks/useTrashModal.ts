/**
 * @fileoverview Hook para gestionar toda la lógica, estado y caché del modal de papelera de reciclaje.
 *
 * @module features/games/hooks/useTrashModal
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTrash, restoreFromTrash, deleteFromTrash, emptyTrash } from "@services/tauri";
import { formatGameDisplayName } from "@/utils/gameImage";
import { toastSuccess, toastError } from "@utils/toast";
import { useConfig } from "@hooks/useConfig";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import type { TrashGameItem } from "@savecloud/types";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

export interface UseTrashModalOptions {
  isOpen: boolean;
  onRestored?: () => void;
}

export interface UseTrashModalResult {
  items: TrashGameItem[];
  filteredItems: TrashGameItem[];
  loading: boolean;
  isFetching: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  actionLoadingId: string | null;
  emptyLoading: boolean;
  confirmEmpty: boolean;
  setConfirmEmpty: (confirm: boolean) => void;
  totalStorageBytes: number;
  gamesById: Map<string, ConfiguredGame>;
  resolvedSteamAppIds: Record<string, string | null | undefined>;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  handleRestore: (gameId: string) => Promise<void>;
  handleDeletePermanent: (gameId: string) => Promise<void>;
  handleEmptyAll: () => Promise<void>;
  refetch: () => Promise<unknown>;
}

export function useTrashModal({ isOpen, onRestored }: UseTrashModalOptions): UseTrashModalResult {
  const { t } = useTranslation();
  const { config } = useConfig();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearch = useDebouncedValue(searchQuery.trim().toLowerCase(), 300);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [emptyLoading, setEmptyLoading] = useState<boolean>(false);
  const [confirmEmpty, setConfirmEmpty] = useState<boolean>(false);

  const {
    data: items = [],
    isLoading: loading,
    isFetching,
    refetch,
  } = useQuery<TrashGameItem[]>({
    queryKey: ["trash-items"],
    queryFn: listTrash,
    enabled: isOpen,
    refetchOnMount: "always",
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isOpen) {
      setConfirmEmpty(false);
      setSearchQuery("");
      void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
    }
  }, [isOpen, queryClient]);

  const handleRestore = async (gameId: string) => {
    setActionLoadingId(`restore-${gameId}`);
    try {
      await restoreFromTrash(gameId);
      toastSuccess(t("library.trashModal.restoreSuccess", { gameId: formatGameDisplayName(gameId) }));
      queryClient.setQueryData<TrashGameItem[]>(["trash-items"], (old: TrashGameItem[] | undefined) =>
        (old ?? []).filter((item: TrashGameItem) => item.gameId !== gameId)
      );
      void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-backups"] });
      onRestored?.();
    } catch (err) {
      toastError(t("library.trashModal.restoreError"), err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeletePermanent = async (gameId: string) => {
    setActionLoadingId(`delete-${gameId}`);
    try {
      await deleteFromTrash(gameId);
      toastSuccess(t("library.trashModal.deletePermanentSuccess", { gameId: formatGameDisplayName(gameId) }));
      queryClient.setQueryData<TrashGameItem[]>(["trash-items"], (old: TrashGameItem[] | undefined) =>
        (old ?? []).filter((item: TrashGameItem) => item.gameId !== gameId)
      );
      void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
    } catch (err) {
      toastError(t("library.trashModal.deletePermanentError"), err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEmptyAll = async () => {
    setEmptyLoading(true);
    try {
      await emptyTrash();
      toastSuccess(t("library.trashModal.emptySuccess"));
      queryClient.setQueryData<TrashGameItem[]>(["trash-items"], []);
      void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      setConfirmEmpty(false);
    } catch (err) {
      toastError(t("library.trashModal.emptyError"), err instanceof Error ? err.message : String(err));
    } finally {
      setEmptyLoading(false);
    }
  };

  // Mapeamos los items buscando si ya existían en la config local o creamos el objeto correspondiente
  const gamesList = useMemo<ConfiguredGame[]>(() => {
    const configuredMap = new Map<string, ConfiguredGame>();
    for (const g of config?.games ?? []) {
      configuredMap.set(g.id, g);
    }
    return items.map((it: TrashGameItem): ConfiguredGame => {
      const existing = configuredMap.get(it.gameId);
      if (existing) return existing;
      return { id: it.gameId, paths: [] };
    });
  }, [items, config?.games]);

  const gamesById = useMemo<Map<string, ConfiguredGame>>(() => {
    const map = new Map<string, ConfiguredGame>();
    for (const g of gamesList) {
      map.set(g.id, g);
    }
    return map;
  }, [gamesList]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(gamesList);
  const isResolvingIds = getIsResolvingIds(gamesList, resolvedSteamAppIds);
  const { mediaBySteamAppId } = useGameMediaBatch({
    games: gamesList,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  const totalStorageBytes = useMemo<number>(() => {
    return items.reduce((acc: number, curr: TrashGameItem) => acc + curr.totalSizeBytes, 0);
  }, [items]);

  const filteredItems = useMemo<TrashGameItem[]>(() => {
    if (!debouncedSearch) return items;
    return items.filter((item: TrashGameItem) => {
      const displayName = formatGameDisplayName(item.gameId).toLowerCase();
      const rawId = item.gameId.toLowerCase();
      return displayName.includes(debouncedSearch) || rawId.includes(debouncedSearch);
    });
  }, [items, debouncedSearch]);

  return {
    items,
    filteredItems,
    loading,
    isFetching,
    searchQuery,
    setSearchQuery,
    actionLoadingId,
    emptyLoading,
    confirmEmpty,
    setConfirmEmpty,
    totalStorageBytes,
    gamesById,
    resolvedSteamAppIds,
    mediaBySteamAppId,
    handleRestore,
    handleDeletePermanent,
    handleEmptyAll,
    refetch,
  };
}
