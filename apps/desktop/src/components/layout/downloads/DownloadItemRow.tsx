import { Progress } from "@heroui/react";
import { Clock, Pause, Play, Upload, Users, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@utils/format";
import { formatEta, formatSpeed } from "@utils/progress";
import type { SourceSyncProgressPayload } from "@services/tauri";
import type { DownloadRow } from "./types";

export interface DownloadItemRowProps {
  row: DownloadRow;
  consoleMode?: boolean;
  togglingHash?: string | null;
  sourcesSyncProgress?: SourceSyncProgressPayload | null;
  onToggleTorrentPause: (infoHash: string, isPaused: boolean) => void;
  onCancelTorrent: (infoHash: string) => void;
  onCancelSource: (jobId: string, infoHash?: string) => void;
  onPauseSource: (jobId: string) => void;
  onResumeSource: (jobId: string) => void;
}

export function DownloadItemRow({
  row,
  consoleMode = false,
  togglingHash,
  sourcesSyncProgress,
  onToggleTorrentPause,
  onCancelTorrent,
  onCancelSource,
  onPauseSource,
  onResumeSource,
}: DownloadItemRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`group border border-default-200/40 bg-default-50/80 transition-colors hover:bg-default-100/60 ${
        consoleMode ? "rounded-2xl p-4" : "rounded-xl p-3"
      }`}>
      {/* Título, subtítulo y porcentaje */}
      <div className={`flex items-start justify-between ${consoleMode ? "mb-2.5 gap-3" : "mb-2 gap-2"}`}>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate leading-tight ${
              consoleMode ? "text-[15px] sm:text-base font-bold text-foreground" : "text-sm font-medium"
            }`}
            title={row.label}>
            {row.label}
          </p>
          <p
            key={row.subtitle}
            className={`animate-text-swap truncate ${
              consoleMode ? "text-xs sm:text-[13px] mt-1" : "text-xs mt-0.5"
            } ${row.statusDetail ? "font-medium text-primary" : "text-default-400"}`}>
            {row.subtitle}
          </p>
        </div>
        <span
          className={`shrink-0 tabular-nums text-primary ${
            consoleMode
              ? "rounded-lg bg-primary/15 px-2.5 py-1 text-xs sm:text-sm font-bold"
              : "rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold"
          }`}>
          {row.value}%
        </span>
      </div>

      {/* Barra de progreso */}
      <Progress
        size={consoleMode ? "md" : "sm"}
        value={row.value}
        aria-label={row.label}
        classNames={{
          track: consoleMode ? "h-2 bg-default-200 rounded-full" : "h-1.5 bg-default-200",
          indicator: row.torrentExtra?.state === "paused" ? "bg-warning" : "bg-primary",
        }}
      />

      {/* Stats comunes: bytes, velocidad de bajada y ETA */}
      {row.id === "remote-sources-sync" ? (
        <div
          className={`flex items-center justify-between text-default-500 ${
            consoleMode ? "mt-2.5 text-xs sm:text-sm" : "mt-2 text-xs"
          }`}>
          <span className="tabular-nums font-medium text-default-600">
            {sourcesSyncProgress?.currentIndex ?? 0} / {sourcesSyncProgress?.totalSources ?? 0}{" "}
            {t("sources.sync.sourcesCountLabel", { defaultValue: "fuentes" })}
          </span>
          {sourcesSyncProgress?.itemsCount != null && (
            <span className="text-[11px] sm:text-xs font-medium text-primary">
              +{sourcesSyncProgress.itemsCount.toLocaleString()}{" "}
              {t("sources.sync.gamesLabel", { defaultValue: "juegos" })}
            </span>
          )}
        </div>
      ) : (
        <div
          className={`flex items-center text-default-500 ${
            consoleMode ? "mt-2.5 gap-4 text-xs sm:text-sm font-medium" : "mt-2 gap-3 text-xs"
          }`}>
          <span className="tabular-nums">
            {formatBytes(row.loaded ?? 0)}
            {(row.total ?? 0) > 0 ? ` / ${formatBytes(row.total ?? 0)}` : ""}
          </span>
          {row.status === "extracting" ? null : (
            <>
              <span className="inline-flex items-center gap-1">
                <Zap size={consoleMode ? 14 : 12} className="text-primary/70" />
                <span className="tabular-nums">{formatSpeed(row.speedBps ?? null)}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={consoleMode ? 14 : 12} className="text-default-400" />
                <span className="tabular-nums">{formatEta(row.etaSeconds ?? null)}</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Stats extra exclusivos de torrents: subida y peers */}
      {row.torrentExtra ? (
        <div
          className={`flex items-center text-default-400 ${
            consoleMode ? "mt-2 gap-4 text-xs sm:text-sm" : "mt-1.5 gap-3 text-xs"
          }`}>
          <span className="inline-flex items-center gap-1">
            <Upload size={consoleMode ? 13 : 11} className="shrink-0 text-default-400" aria-hidden />
            <span className="tabular-nums">{formatSpeed(row.torrentExtra.uploadSpeedBytes)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Users size={consoleMode ? 13 : 11} className="shrink-0 text-default-400" aria-hidden />
            <span className="tabular-nums">{t("downloads.peer", { count: row.torrentExtra.peersConnected })}</span>
          </span>
        </div>
      ) : null}

      {/* Acciones para sync */}
      {row.source === "sync" && (row.canPause || row.canCancel) ? (
        <div className={`flex items-center ${consoleMode ? "mt-3 gap-2.5" : "mt-2.5 gap-2"}`}>
          {row.canPause ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-default-100 font-semibold text-default-600 transition-colors hover:bg-default-200 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}>
              <Pause size={consoleMode ? 14 : 12} />
              {t("downloads.pause")}
            </button>
          ) : null}
          {row.canCancel ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-danger-50 font-semibold text-danger transition-colors hover:bg-danger-100 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}>
              <X size={consoleMode ? 14 : 12} />
              {t("downloads.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Acciones para sources */}
      {row.source === "sources" && row.jobId ? (
        <div className={`flex items-center ${consoleMode ? "mt-3 gap-2.5" : "mt-2.5 gap-2"}`}>
          {row.canPause ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-default-100 font-semibold text-default-600 transition-colors hover:bg-default-200 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}
              onClick={() => onPauseSource(row.jobId!)}>
              <Pause size={consoleMode ? 14 : 12} />
              {t("downloads.pause")}
            </button>
          ) : null}
          {row.canResume ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-success-50 font-semibold text-success transition-colors hover:bg-success-100 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}
              onClick={() => onResumeSource(row.jobId!)}>
              <Zap size={consoleMode ? 14 : 12} />
              {t("downloads.resume")}
            </button>
          ) : null}
          {row.canCancel ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-danger-50 font-semibold text-danger transition-colors hover:bg-danger-100 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}
              onClick={() => onCancelSource(row.jobId!, row.infoHash)}>
              <X size={consoleMode ? 14 : 12} />
              {t("downloads.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Acciones para torrents directos (sin job de sources) */}
      {row.source === "torrent" && row.infoHash && (row.canPause || row.canCancel) ? (
        <div className={`flex items-center ${consoleMode ? "mt-3 gap-2.5" : "mt-2.5 gap-2"}`}>
          {row.canPause ? (
            <button
              type="button"
              disabled={togglingHash === row.infoHash}
              className={`inline-flex cursor-pointer items-center bg-default-100 font-semibold text-default-600 transition-colors hover:bg-default-200 active:scale-95 disabled:opacity-50 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}
              onClick={() => onToggleTorrentPause(row.infoHash!, !!row.isPaused)}>
              {row.isPaused ? <Play size={consoleMode ? 14 : 12} /> : <Pause size={consoleMode ? 14 : 12} />}
              {row.isPaused ? t("downloads.resume") : t("downloads.pause")}
            </button>
          ) : null}
          {row.canCancel ? (
            <button
              type="button"
              className={`inline-flex cursor-pointer items-center bg-danger-50 font-semibold text-danger transition-colors hover:bg-danger-100 active:scale-95 ${
                consoleMode
                  ? "h-9 px-3.5 text-xs sm:text-sm rounded-xl gap-2"
                  : "rounded-md px-2.5 py-1.5 text-xs gap-1.5"
              }`}
              onClick={() => onCancelTorrent(row.infoHash!)}>
              <X size={consoleMode ? 14 : 12} />
              {t("downloads.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
