import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  exportSourceToJson,
  exportSourcesToJson,
  getVerifiedSourcesStatus,
  importSourceFromFile,
  importSourceFromUrl,
  importSourcesFromFilesBatch,
  installVerifiedSources,
  listRemoteSources,
  listSourcesSummary,
  removeRemoteSource,
  removeSource,
  setRemoteSourceEnabled,
  syncRemoteSources,
  upsertRemoteSource,
} from "@services/tauri/sources.service";
import { setDefaultSourceDownloadDir, getDefaultSourceDownloadDir, setProxyUrl } from "@services/tauri";
import { useConfig } from "@hooks/useConfig";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import i18n from "@lib/i18n";

export function useSourcesSettings() {
  const queryClient = useQueryClient();
  const { config } = useConfig();

  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [remoteSourceUrl, setRemoteSourceUrl] = useState("");
  const [defaultSourceDownloadDir, setDefaultSourceDownloadDirState] = useState("");
  const [proxyUrl, setProxyUrlState] = useState("");
  const [deletingSourceIds, setDeletingSourceIds] = useState<Set<string>>(new Set());
  const [deletingRemoteSourceIds, setDeletingRemoteSourceIds] = useState<Set<string>>(new Set());
  const [exportingSourceIds, setExportingSourceIds] = useState<Set<string>>(new Set());
  const [exportingAllSources, setExportingAllSources] = useState(false);

  const { data: sourcesSummary = [] } = useQuery({
    queryKey: ["sources-catalogs"],
    queryFn: listSourcesSummary,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: remoteSources = [] } = useQuery({
    queryKey: ["remote-sources"],
    queryFn: listRemoteSources,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: verifiedSourcesStatus = null } = useQuery({
    queryKey: ["verified-sources-status"],
    queryFn: getVerifiedSourcesStatus,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: defaultSourceDownloadDirFromConfig = "" } = useQuery({
    queryKey: ["defaultSourceDownloadDir"],
    queryFn: async () => (await getDefaultSourceDownloadDir()) ?? "",
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    setDefaultSourceDownloadDirState(defaultSourceDownloadDirFromConfig);
  }, [defaultSourceDownloadDirFromConfig]);

  useEffect(() => {
    if (config?.proxyUrl !== undefined) {
      setProxyUrlState(config.proxyUrl ?? "");
    }
  }, [config?.proxyUrl]);

  const handleImportSourceByUrl = async (mode: "merge" | "replace") => {
    if (!sourceUrl.trim()) return;
    setSourcesBusy(true);
    try {
      await importSourceFromUrl(sourceUrl.trim(), mode);
      toastSuccess(
        i18n.t("settings.toast.sourceImportUrlSuccess"),
        i18n.t("settings.toast.sourceImportUrlSuccessDesc")
      );
      setSourceUrl("");
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleImportSourceByFile = async (mode: "merge" | "replace" | "updateorcreate") => {
    setSourcesBusy(true);
    try {
      const path = await open({
        title: "Seleccionar JSON de fuente",
        directory: false,
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      await importSourceFromFile(path, mode);
      toastSuccess(
        i18n.t("settings.toast.sourceImportFileSuccess"),
        i18n.t("settings.toast.sourceImportFileSuccessDesc")
      );
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleImportSourcesBatch = async (mode: "merge" | "replace" | "updateorcreate") => {
    setSourcesBusy(true);
    try {
      const paths = await open({
        title: "Seleccionar múltiples JSONs de fuentes",
        directory: false,
        multiple: true,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!paths || !Array.isArray(paths) || paths.length === 0) return;

      const result = await importSourcesFromFilesBatch(paths, mode);

      if (result.failed === 0) {
        toastSuccess(
          i18n.t("settings.toast.sourcesImportedCountSuccess", { count: result.succeeded }),
          i18n.t("settings.toast.sourcesImportedCountSuccessDesc")
        );
      } else if (result.succeeded === 0) {
        toastError(
          i18n.t("settings.toast.importError"),
          i18n.t("settings.toast.noSourceImportedError", { error: result.items[0]?.error ?? "" })
        );
      } else {
        const updated = result.items.filter((i) => i.wasUpdated).length;
        const newOnes = result.succeeded - updated;
        toastSuccess(
          i18n.t("settings.toast.syncFinished", { count: result.succeeded }),
          `${newOnes} nuevas, ${updated} actualizadas. ${result.failed > 0 ? "Revisa los detalles." : ""}`
        );
      }

      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleSelectDefaultSourceDownloadDir = async () => {
    const path = await open({
      title: "Seleccionar carpeta de descargas",
      directory: true,
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    setDefaultSourceDownloadDirState(path);
    await setDefaultSourceDownloadDir(path);
    queryClient.setQueryData(["defaultSourceDownloadDir"], path);
    queryClient.invalidateQueries({ queryKey: ["config"] });
  };

  const handleSaveDefaultSourceDownloadDir = async () => {
    try {
      const next = defaultSourceDownloadDir.trim() || null;
      await setDefaultSourceDownloadDir(next);
      queryClient.setQueryData(["defaultSourceDownloadDir"], next ?? "");
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(i18n.t("settings.toast.pathSaved"), i18n.t("settings.toast.pathSavedDesc"));
    } catch (e) {
      toastError(i18n.t("settings.toast.pathSaveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveProxyUrl = async () => {
    try {
      const next = proxyUrl.trim() || null;
      await setProxyUrl(next);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.proxySaved"),
        next ? i18n.t("settings.toast.proxySavedUpdatedDesc") : i18n.t("settings.toast.proxySavedDisabledDesc")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.proxySaveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    setDeletingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await removeSource(sourceId);
      toastSuccess(i18n.t("settings.toast.sourceDeleted"), i18n.t("settings.toast.sourceDeletedDesc"));
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceDeleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const handleRegisterRemoteSource = async () => {
    const url = remoteSourceUrl.trim();
    if (!url) return;

    setSourcesBusy(true);
    try {
      await upsertRemoteSource(url, true);
      setRemoteSourceUrl("");
      toastSuccess(i18n.t("settings.toast.sourceAdded"), i18n.t("settings.toast.sourceAddedDesc"));
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceAddError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleToggleRemoteSourceEnabled = async (sourceId: string, enabled: boolean) => {
    setSourcesBusy(true);
    try {
      await setRemoteSourceEnabled(sourceId, enabled);
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      toastSuccess(
        enabled ? i18n.t("settings.toast.sourceEnabled") : i18n.t("settings.toast.sourcePaused"),
        i18n.t("settings.toast.sourceStatusUpdatedDesc")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceStatusUpdateError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleDeleteRemoteSource = async (sourceId: string) => {
    setDeletingRemoteSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await removeRemoteSource(sourceId);
      toastSuccess(i18n.t("settings.toast.sourceRemoteDeleted"), i18n.t("settings.toast.sourceRemoteDeletedDesc"));
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceRemoteDeleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingRemoteSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const handleInstallVerifiedSources = async () => {
    setSourcesBusy(true);
    try {
      const result = await installVerifiedSources(true);
      toastSuccess(
        i18n.t("settings.toast.verifiedSourcesInstalledSuccess"),
        i18n.t("settings.toast.verifiedSourcesInstalledSuccessDesc", {
          total: result.total,
          updated: result.updated,
          unchanged: result.unchanged,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["verified-sources-status"] });
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.verifiedSourcesInstallError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleSyncRemoteSources = async () => {
    setSourcesBusy(true);
    try {
      const result = await syncRemoteSources();
      toastSuccess(
        i18n.t("settings.toast.syncFinished", { count: result.total }),
        i18n.t("settings.toast.syncFinishedDesc", {
          updated: result.updated,
          unchanged: result.unchanged,
          failed: result.failed,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.syncFinishedError"), e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleExportAllSources = async () => {
    setExportingAllSources(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultName = `savecloud-sources-${dateStr}.json`;
      const path = await save({
        title: i18n.t("settings.sourceInstall.exportAllButton"),
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const savedPath = await exportSourcesToJson(path);
      toastSuccess(i18n.t("settings.toast.exportSuccess"), savedPath);
    } catch (e) {
      toastError(i18n.t("settings.toast.exportError"), e instanceof Error ? e.message : String(e));
    } finally {
      setExportingAllSources(false);
    }
  };

  const handleExportSource = async (sourceId: string, sourceName: string) => {
    setExportingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      const safeName = sourceName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultName = `source-${safeName}-${dateStr}.json`;
      const path = await save({
        title: `${i18n.t("settings.sourceInstall.exportSourceTooltip")}: ${sourceName}`,
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const savedPath = await exportSourceToJson(sourceId, path);
      toastSuccess(i18n.t("settings.toast.exportSuccess"), savedPath);
    } catch (e) {
      toastError(i18n.t("settings.toast.exportError"), e instanceof Error ? e.message : String(e));
    } finally {
      setExportingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  return {
    sourcesBusy,
    sourceUrl,
    setSourceUrl,
    remoteSourceUrl,
    setRemoteSourceUrl,
    defaultSourceDownloadDir,
    setDefaultSourceDownloadDir: setDefaultSourceDownloadDirState,
    proxyUrl,
    setProxyUrl: setProxyUrlState,
    sourcesSummary,
    remoteSources,
    verifiedSourcesStatus,
    deletingSourceIds,
    deletingRemoteSourceIds,
    exportingSourceIds,
    exportingAllSources,
    handleImportSourceByUrl,
    handleImportSourceByFile,
    handleImportSourcesBatch,
    handleExportAllSources,
    handleExportSource,
    handleSelectDefaultSourceDownloadDir,
    handleSaveDefaultSourceDownloadDir,
    handleSaveProxyUrl,
    handleDeleteSource,
    handleRegisterRemoteSource,
    handleToggleRemoteSourceEnabled,
    handleDeleteRemoteSource,
    handleInstallVerifiedSources,
    handleSyncRemoteSources,
  };
}
