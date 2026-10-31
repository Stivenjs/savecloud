import { Button, Card, CardBody, Chip, Progress, Spinner, Tooltip } from "@heroui/react";
import { AlertCircle, CheckCircle2, Download, ExternalLink, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@utils/format";
import { formatEta, formatSpeed } from "@utils/progress";
import type { EmulatorCatalogEntry, EmulatorProgressById, EmulatorStatuses } from "../types/emulatorCatalog";

interface EmulatorCatalogCardProps {
  emulator: EmulatorCatalogEntry;
  status: EmulatorStatuses[string] | undefined;
  progress: EmulatorProgressById[string] | undefined;
  statusUnavailable: boolean;
  onInstall: (emulatorId: string) => void;
  onPickExecutable: (emulatorId: string, emulatorName: string) => void;
  onOpenUrl: (url: string) => void;
}

/** Ficha del catálogo con estado instalado, progreso y acciones del emulador. */
export function EmulatorCatalogCard({
  emulator,
  status,
  progress,
  statusUnavailable,
  onInstall,
  onPickExecutable,
  onOpenUrl,
}: EmulatorCatalogCardProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";
  const installed = Boolean(status?.installed);
  const downloading = progress?.status === "downloading";
  const extracting = progress?.status === "extracting";
  const busy = downloading || extracting;

  return (
    <Card className="group overflow-hidden border border-default-200/70 bg-content1 shadow-sm transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-default-300 dark:border-default-100/15 dark:hover:border-default-100/30">
      <div className="relative h-36 overflow-hidden bg-default-100 sm:h-40">
        <img
          src={emulator.imageUrl}
          alt={t("settings.emulators.coverAlt", { name: emulator.name })}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute right-3 top-3">
          {installed ? (
            <Chip
              size="sm"
              color="success"
              variant="flat"
              startContent={<CheckCircle2 size={12} />}
              className="border border-success-400/20 bg-background/90 text-[10px] font-medium backdrop-blur-sm">
              {t("settings.emulators.detected")}
            </Chip>
          ) : busy ? (
            <Chip
              size="sm"
              color="warning"
              variant="flat"
              startContent={<Spinner size="sm" color="warning" />}
              className="border border-warning-400/20 bg-background/90 text-[10px] font-medium backdrop-blur-sm">
              {downloading ? t("settings.emulators.downloading") : t("settings.emulators.extracting")}
            </Chip>
          ) : (
            <Chip
              size="sm"
              variant="flat"
              className="border border-default-200/60 bg-background/90 text-[10px] font-medium backdrop-blur-sm">
              {t("settings.emulators.notInstalled")}
            </Chip>
          )}
        </div>
      </div>

      <CardBody className="gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{emulator.name}</h2>
            <p className="mt-0.5 text-xs text-default-500">{emulator.console}</p>
          </div>
          <span className="rounded-md border border-default-200/70 px-2 py-1 font-mono text-[10px] text-default-500 dark:border-default-100/15">
            {emulator.license}
          </span>
        </div>

        <p className="min-h-10 text-xs leading-relaxed text-default-600 dark:text-default-400">
          {emulator.description[language]}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {emulator.supportedPlatforms.map((platform) => (
            <span
              key={platform}
              className="rounded-full bg-default-100/80 px-2 py-1 text-[10px] text-default-500 dark:bg-default-100/10">
              {platform}
            </span>
          ))}
          {emulator.saveSyncSupported && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
              {t("settings.emulators.saveSyncSupported")}
            </span>
          )}
          <span className="ml-auto text-[10px] text-default-400">
            {t("settings.emulators.developer", { name: emulator.developer })}
          </span>
        </div>

        {installed && status?.path && (
          <Tooltip content={status.path} placement="top" delay={400}>
            <p className="truncate rounded-md bg-default-50 px-2.5 py-2 font-mono text-[10px] text-default-500 dark:bg-default-100/5">
              {status.path}
            </p>
          </Tooltip>
        )}

        {progress?.status === "failed" && progress.error && (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-danger-500">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{progress.error}</span>
          </p>
        )}

        {busy && progress && (
          <div className="space-y-1.5">
            <Progress
              size="sm"
              color={extracting ? "secondary" : "primary"}
              value={extracting ? 100 : progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0}
              isIndeterminate={extracting || progress.total <= 0}
            />
            {downloading && progress.total > 0 && (
              <div className="flex justify-between font-mono text-[10px] text-default-400">
                <span>
                  {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
                </span>
                <span>
                  {progress.speed ? `${formatSpeed(progress.speed)} · ` : ""}
                  {progress.eta ? formatEta(progress.eta) : ""}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-default-100 pt-3 dark:border-default-100/10">
          <Button
            size="sm"
            color="primary"
            variant={installed ? "flat" : "solid"}
            isDisabled={statusUnavailable || busy || installed || !emulator.managedInstall}
            onPress={() => onInstall(emulator.id)}
            startContent={busy ? <Spinner size="sm" color="current" /> : <Download size={13} />}
            className="h-8 min-w-28 text-xs font-medium active:scale-[0.98]">
            {busy
              ? extracting
                ? t("settings.emulators.extracting")
                : t("settings.emulators.downloading")
              : installed
                ? t("settings.emulators.alreadyInstalled")
                : t("settings.emulators.downloadButton")}
          </Button>
          <Button
            size="sm"
            variant="flat"
            isDisabled={busy}
            onPress={() => onPickExecutable(emulator.id, emulator.name)}
            startContent={<FolderOpen size={13} />}
            className="h-8 text-xs active:scale-[0.98]">
            {installed ? t("settings.emulators.changeExecutable") : t("settings.emulators.selectExecutable")}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="light"
              onPress={() => onOpenUrl(emulator.downloadUrl)}
              endContent={<ExternalLink size={12} />}>
              {t("settings.emulators.officialDownloads")}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
