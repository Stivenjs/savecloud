import { useEffect, useState, useCallback } from "react";
import { Button, Card, CardBody, Progress, Tooltip, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Download, FolderOpen, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import {
  detectEmulators,
  setEmulatorPath,
  downloadEmulator,
  type EmulatorStatus,
  type EmulatorProgressPayload,
} from "@services/tauri/emulators.service";
import { formatBytes } from "@utils/format";
import { formatSpeed, formatEta } from "@utils/progress";

export function EmulatorIntegrationsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: statuses = {}, isLoading: loading } = useQuery<Record<string, EmulatorStatus>>({
    queryKey: ["emulators-status"],
    queryFn: detectEmulators,
  });

  const [progresses, setProgresses] = useState<Record<string, EmulatorProgressPayload>>({});

  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["emulators-status"] });
  }, [queryClient]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenConfig: (() => void) | undefined;

    void listen<EmulatorProgressPayload>("emulator-download-progress", (event) => {
      const payload = event.payload;
      setProgresses((prev) => ({
        ...prev,
        [payload.emulator]: payload,
      }));

      if (payload.status === "finished" || payload.status === "failed") {
        void refreshStatus();
      }
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void listen("config-changed", () => {
      void refreshStatus();
    }).then((fn) => {
      unlistenConfig = fn;
    });

    return () => {
      unlistenProgress?.();
      unlistenConfig?.();
    };
  }, [refreshStatus]);

  const handlePickFile = async (emulatorKey: string) => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("settings.emulators.selectExecutableTitle", {
          name: emulatorKey === "ryujinx" ? "Ryujinx" : "ShadPS4",
        }),
        filters: [
          { name: t("settings.emulators.executablesFilter"), extensions: ["exe"] },
          { name: t("settings.emulators.allFilesFilter"), extensions: ["*"] },
        ],
      });

      if (selected && typeof selected === "string") {
        await setEmulatorPath(emulatorKey, selected);
        await refreshStatus();
      }
    } catch (e) {
      console.error("Error al elegir ejecutable:", e);
    }
  };

  const handleDownload = async (emulatorKey: string) => {
    setProgresses((prev) => ({
      ...prev,
      [emulatorKey]: {
        emulator: emulatorKey,
        status: "downloading",
        loaded: 0,
        total: 100,
        speed: 0,
        eta: null,
      },
    }));

    try {
      await downloadEmulator(emulatorKey);
    } catch (e) {
      console.error("Error al iniciar descarga del emulador:", e);
      setProgresses((prev) => ({
        ...prev,
        [emulatorKey]: {
          emulator: emulatorKey,
          status: "failed",
          loaded: 0,
          total: 100,
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  const renderEmulatorRow = (key: string, label: string, subtitle: string) => {
    const status = statuses[key];
    const progress = progresses[key];

    const isDownloading = progress?.status === "downloading";
    const isExtracting = progress?.status === "extracting";
    const isBusy = isDownloading || isExtracting;

    const isInstalled = status?.installed;
    const path = status?.path;

    return (
      <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 border-b last:border-0 border-default-100">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-default-800">{label}</span>
              {isInstalled ? (
                <Chip
                  size="sm"
                  color="success"
                  variant="flat"
                  startContent={<CheckCircle2 size={11} />}
                  className="h-5 text-[10px] px-1.5">
                  {t("settings.emulators.detected")}
                </Chip>
              ) : isBusy ? (
                <Chip
                  size="sm"
                  color="warning"
                  variant="flat"
                  startContent={<Loader2 size={11} className="animate-spin" />}
                  className="h-5 text-[10px] px-1.5">
                  {isDownloading ? t("settings.emulators.downloading") : t("settings.emulators.extracting")}
                </Chip>
              ) : (
                <Chip
                  size="sm"
                  color="danger"
                  variant="flat"
                  startContent={<XCircle size={11} />}
                  className="h-5 text-[10px] px-1.5">
                  {t("settings.emulators.notInstalled")}
                </Chip>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-default-400">{subtitle}</p>
            {isInstalled && path && (
              <Tooltip content={path} placement="top" delay={400}>
                <p className="mt-1 truncate font-mono text-[9px] text-default-500 max-w-[280px]">{path}</p>
              </Tooltip>
            )}
            {progress?.status === "failed" && progress.error && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-danger-500">
                <AlertTriangle size={10} className="shrink-0" />
                <span>{progress.error}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isInstalled && !isBusy && (
              <Button
                size="sm"
                variant="flat"
                color="primary"
                onPress={() => handleDownload(key)}
                startContent={<Download size={12} />}
                className="h-8 text-xs font-medium">
                {t("settings.emulators.downloadButton")}
              </Button>
            )}
            <Tooltip
              content={
                isInstalled
                  ? t("settings.emulators.changeExecutableTooltip")
                  : t("settings.emulators.searchExecutableTooltip")
              }>
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                color="default"
                isDisabled={isBusy}
                onPress={() => handlePickFile(key)}
                className="h-8 w-8 min-w-0"
                aria-label={t("settings.emulators.pickExecutableTooltip")}>
                <FolderOpen size={13} />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Barra de progreso de descarga / extracción */}
        {isBusy && progress && (
          <div className="space-y-1">
            <Progress
              size="sm"
              color={isExtracting ? "secondary" : "primary"}
              value={isExtracting ? 100 : (progress.loaded / (progress.total || 100)) * 100}
              isIndeterminate={isExtracting}
              className="max-w-full"
            />
            {isDownloading && (
              <div className="flex items-center justify-between text-[9px] text-default-400 font-mono">
                <span>
                  {formatBytes(progress.loaded)} de {formatBytes(progress.total)}
                </span>
                <span className="flex items-center gap-2">
                  {progress.speed !== undefined && progress.speed !== null && (
                    <span>{formatSpeed(progress.speed)}</span>
                  )}
                  {progress.eta !== undefined && progress.eta !== null && <span>ETA: {formatEta(progress.eta)}</span>}
                </span>
              </div>
            )}
            {isExtracting && (
              <span className="text-[9px] text-secondary-400 font-mono">{t("settings.emulators.decompressing")}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="shadow-sm">
      <CardBody className="gap-5 p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/10">
            <Gamepad2 size={18} className="text-secondary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-default-900">{t("settings.emulators.title")}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-default-500">{t("settings.emulators.subtitle")}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-default-100" />

        {/* List */}
        {loading ? (
          <div className="flex h-20 items-center justify-center text-default-400 text-xs">
            <Loader2 size={14} className="animate-spin mr-1.5" />
            {t("settings.emulators.loading")}
          </div>
        ) : (
          <div className="flex flex-col">
            {renderEmulatorRow("ryujinx", "Ryujinx", t("settings.emulators.ryujinxSubtitle"))}
            {renderEmulatorRow("shadps4", "ShadPS4", t("settings.emulators.shadps4Subtitle"))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
