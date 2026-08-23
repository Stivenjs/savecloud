import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { getPluginStorage, clearPluginStorage, type PluginInfo, type PluginStorageEntry } from "@services/tauri";
import { toastSuccess, toastError } from "@utils/toast";

export function usePluginStorage(plugin: PluginInfo | null, isOpen: boolean) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 200);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const {
    data: entries = [],
    isLoading,
    refetch,
  } = useQuery<PluginStorageEntry[]>({
    queryKey: ["plugin-storage", plugin?.id],
    queryFn: () => (plugin?.id ? getPluginStorage(plugin.id) : Promise.resolve([])),
    enabled: isOpen && Boolean(plugin?.id),
  });

  const clearMutation = useMutation<void, unknown, void>({
    mutationFn: () => (plugin?.id ? clearPluginStorage(plugin.id) : Promise.resolve()),
    onSuccess: () => {
      toastSuccess(
        t("settings.plugins.storage.toastCleared"),
        t("settings.plugins.storage.toastClearedDesc", { name: plugin?.name })
      );
      setIsConfirmingClear(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["installed-plugins"] });
    },
    onError: (err: unknown) => {
      toastError(t("settings.plugins.storage.toastClearError"), String(err));
    },
  });

  const filteredEntries = useMemo(() => {
    if (!debouncedFilter.trim()) return entries;
    const q = debouncedFilter.toLowerCase();
    return entries.filter(
      (e: PluginStorageEntry) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
    );
  }, [entries, debouncedFilter]);

  const handleCopy = (text: string, key: string): void => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatDate = (timestampSecs: number): string => {
    if (!timestampSecs) return "-";
    const date = new Date(timestampSecs * 1000);
    return date.toLocaleString();
  };

  return {
    entries,
    filteredEntries,
    isLoading,
    filter,
    setFilter,
    copiedKey,
    isConfirmingClear,
    setIsConfirmingClear,
    isClearingPending: clearMutation.isPending,
    refetch,
    handleCopy,
    formatDate,
    handleClearStorage: () => clearMutation.mutate(),
  };
}
