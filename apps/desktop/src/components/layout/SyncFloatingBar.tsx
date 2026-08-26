import { motion } from "framer-motion";
import { Spinner, Tooltip } from "@heroui/react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { SyncProgressState } from "@store/SyncStore";
import { formatBytes } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatEta, formatSpeed } from "@utils/progress";
import { Clock, HardDrive, Pause, Upload, X, Zap } from "lucide-react";

interface SyncFloatingBarProps {
  progress: SyncProgressState;
  constraintsRef: RefObject<HTMLDivElement | null>;
  isIndeterminate: boolean;
  value: number;
  canPause: boolean;
  canCancel: boolean;
  speedBps: number | null;
  etaSeconds: number | null;
  onCancel: () => void;
  onPause: () => void;
}

export function SyncFloatingBar({
  progress,
  constraintsRef,
  isIndeterminate,
  value,
  canPause,
  canCancel,
  speedBps,
  etaSeconds,
  onCancel,
  onPause,
}: SyncFloatingBarProps) {
  const { t } = useTranslation();
  const isUpload = progress.type === "upload";

  return (
    <motion.div
      key="sync-progress"
      drag
      dragConstraints={constraintsRef}
      dragElastic={0.1}
      dragMomentum={false}
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 48, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed bottom-4 left-6 right-6 z-50 cursor-grab rounded-xl border border-default-200 bg-default-50/95 px-4 py-3.5 shadow-lg backdrop-blur active:cursor-grabbing sm:left-1/2 sm:right-auto sm:w-96 sm:-translate-x-1/2"
      aria-label={isUpload ? t("sync.uploadProgress") : t("sync.downloadProgress")}
      role="status"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isUpload ? "bg-primary/10 text-primary" : "bg-success/10 text-success"
            }`}>
            {isUpload ? <Upload size={10} aria-hidden /> : <HardDrive size={10} aria-hidden />}
            {isUpload ? t("sync.uploading") : t("sync.downloading")}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{formatGameDisplayName(progress.gameId)}</span>
        </div>
        <span className="shrink-0 text-xs font-semibold text-default-500 tabular-nums">
          {isIndeterminate ? "—" : progress.total > 0 ? `${value}%` : "—"}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-default-400">{progress.filename}</p>
        {isUpload && (canPause || canCancel) && (
          <>
            <span className="shrink-0 text-default-200 select-none" aria-hidden>
              |
            </span>
            <span className="flex shrink-0 gap-1 pointer-events-auto">
              {canPause ? (
                <Tooltip content={t("sync.pauseUpload")} placement="top">
                  <button
                    type="button"
                    onClick={onPause}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-foreground hover:bg-default-200 transition-colors"
                    aria-label={t("sync.pauseUpload")}
                    onPointerDownCapture={(e) => e.stopPropagation()}>
                    <Pause size={14} />
                  </button>
                </Tooltip>
              ) : null}
              {canCancel ? (
                <Tooltip content={t("sync.cancelUpload")} placement="top">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors"
                    aria-label={t("sync.cancelUpload")}
                    onPointerDownCapture={(e) => e.stopPropagation()}>
                    <X size={14} />
                  </button>
                </Tooltip>
              ) : null}
            </span>
          </>
        )}
      </div>

      {isIndeterminate ? (
        <div className="mt-2.5 flex items-center gap-2">
          <Spinner size="sm" color="primary" aria-label={t("sync.preparingData")} />
          <p className="text-xs text-default-500">{t("sync.preparingDataDesc")}</p>
        </div>
      ) : (
        <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-default-200">
          <div
            className="h-full rounded-full bg-primary transform-gpu will-change-[width] transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
          />
          {value > 0 && value < 100 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/40 animate-pulse pointer-events-none"
              style={{ width: `${Math.min(Math.max(value + 4, 0), 100)}%` }}
            />
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-default-400">
        <span className="inline-flex items-center gap-1.5">
          {isUpload ? (
            <Upload size={11} className="shrink-0 text-primary" aria-hidden />
          ) : (
            <HardDrive size={11} className="shrink-0 text-primary" aria-hidden />
          )}
          <span>
            {isUpload ? t("sync.sent") : t("sync.onDisk")}:{" "}
            <span className="tabular-nums font-medium text-default-500">
              {formatBytes(progress.loaded)}
              {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ""}
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Zap size={11} className="shrink-0 text-default-400" aria-hidden />
          <span>
            {t("sync.speed")}:{" "}
            <span className="tabular-nums font-medium text-default-500">{formatSpeed(speedBps)}</span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={11} className="shrink-0 text-default-400" aria-hidden />
          {!isIndeterminate && progress.total > 0 ? (
            <span className="tabular-nums font-medium text-default-500">{formatEta(etaSeconds)}</span>
          ) : (
            <span>—</span>
          )}
        </span>
      </div>
    </motion.div>
  );
}
