import { useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  syncSteamCatalog,
  resetSteamCatalogSync,
  exportSteamSeedManifestToCloud,
  resetCloudSeedState,
  importCloudSeedRunUntilDone,
  type SteamCatalogSyncProgressPayload,
  type SteamSeedImportProgressPayload,
} from "@services/tauri";
import { STEAM_SEED_FRESHNESS_QUERY_KEY } from "@features/steam-catalog/hooks/useSteamSeedFreshness";
import { useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import i18n from "@lib/i18n";

export function useSteamCatalogSettings() {
  const queryClient = useQueryClient();

  const [steamCatalogBusy, setSteamCatalogBusy] = useState(false);
  const [steamSeedBusy, setSteamSeedBusy] = useState(false);
  const [resetSteamCatalogConfirmOpen, setResetSteamCatalogConfirmOpen] = useState(false);
  const [steamCatalogSyncProgress, setSteamCatalogSyncProgress] = useState<SteamCatalogSyncProgressPayload | null>(
    null
  );
  const [steamSeedImportProgress, setSteamSeedImportProgress] = useState<SteamSeedImportProgressPayload | null>(null);

  const handleSyncSteamCatalog = async () => {
    if (steamCatalogBusy || steamSeedBusy) {
      toastError(i18n.t("settings.toast.syncInProgress"), i18n.t("settings.toast.waitProcesses"));
      return;
    }

    setSteamCatalogBusy(true);
    setSteamCatalogSyncProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SteamCatalogSyncProgressPayload>("steam-catalog-sync-progress", (ev) => {
        setSteamCatalogSyncProgress(ev.payload);
      });
      const stats = await syncSteamCatalog();
      toastSuccess(
        i18n.t("settings.toast.steamListUpdated"),
        i18n.t("settings.toast.steamListUpdatedDesc", {
          count: stats.appsUpserted.toLocaleString(),
          batches: stats.batches,
          mode:
            stats.mode === "full"
              ? i18n.t("settings.toast.steamListUpdateDescFull")
              : i18n.t("settings.toast.steamListUpdateDescDelta"),
        })
      );
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.steamListUpdateError"), e instanceof Error ? e.message : String(e));
    } finally {
      unlisten?.();
      setSteamCatalogSyncProgress(null);
      setSteamCatalogBusy(false);
    }
  };

  const handleResetSteamCatalogSync = () => {
    setResetSteamCatalogConfirmOpen(true);
  };

  const confirmResetSteamCatalogSync = async () => {
    if (steamCatalogBusy || steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesReset"));
      return;
    }

    setSteamCatalogBusy(true);
    try {
      await resetSteamCatalogSync();
      toastSuccess(i18n.t("settings.toast.catalogResetSuccess"), i18n.t("settings.toast.catalogResetSuccessDesc"));
      setResetSteamCatalogConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.catalogResetError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSteamCatalogBusy(false);
    }
  };

  const handleExportSteamSeedManifest = async () => {
    if (steamCatalogBusy || steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesExport"));
      return;
    }

    setSteamSeedBusy(true);
    try {
      const result = await exportSteamSeedManifestToCloud();
      toastSuccess(
        i18n.t("settings.toast.listSent"),
        i18n.t("settings.toast.listSentDesc", {
          count: result.appIdsExported.toLocaleString(),
          parts: result.partsUploaded,
        })
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotSendList"), e instanceof Error ? e.message : String(e));
    } finally {
      setSteamSeedBusy(false);
    }
  };

  const handleResetCloudSeed = async () => {
    if (steamCatalogBusy || steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesResetCloud"));
      return;
    }

    setSteamSeedBusy(true);
    try {
      await resetCloudSeedState();
      toastSuccess(i18n.t("settings.toast.cloudSeedResetSuccess"), i18n.t("settings.toast.cloudSeedResetSuccessDesc"));
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotRestart"), e instanceof Error ? e.message : String(e));
    } finally {
      setSteamSeedBusy(false);
    }
  };

  const handleImportCloudSeedFromCloud = async () => {
    if (steamCatalogBusy || steamSeedBusy) {
      toastError(i18n.t("settings.toast.syncInProgress"), i18n.t("settings.toast.waitProcessesDownload"));
      return;
    }

    setSteamSeedBusy(true);
    setSteamSeedImportProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SteamSeedImportProgressPayload>("steam-seed-import-progress", (ev) => {
        setSteamSeedImportProgress(ev.payload);
      });
      const result = await importCloudSeedRunUntilDone();
      const trending =
        result.trendingPriorityEntries > 0
          ? i18n.t("settings.toast.downloadInfoSuccessDescTrending", { count: result.trendingPriorityEntries })
          : "";
      toastSuccess(
        i18n.t("settings.toast.downloadInfoSuccess"),
        i18n.t("settings.toast.downloadInfoSuccessDesc", {
          rows: result.rowsUpdated.toLocaleString(),
          batches: result.batchesProcessed,
          rounds: result.rounds,
          trending,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotDownloadInfo"), e instanceof Error ? e.message : String(e));
    } finally {
      unlisten?.();
      setSteamSeedImportProgress(null);
      setSteamSeedBusy(false);
    }
  };

  return {
    steamCatalogBusy,
    steamSeedBusy,
    resetSteamCatalogConfirmOpen,
    setResetSteamCatalogConfirmOpen,
    steamCatalogSyncProgress,
    steamSeedImportProgress,
    handleSyncSteamCatalog,
    handleResetSteamCatalogSync,
    confirmResetSteamCatalogSync,
    handleExportSteamSeedManifest,
    handleResetCloudSeed,
    handleImportCloudSeedFromCloud,
  };
}
