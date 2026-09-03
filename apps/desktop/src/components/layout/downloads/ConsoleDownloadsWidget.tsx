import { useState } from "react";
import { ScrollShadow } from "@heroui/react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DownloadsHeader } from "./DownloadsHeader";
import { DownloadsAggregateProgress } from "./DownloadsAggregateProgress";
import { DownloadItemRow } from "./DownloadItemRow";
import type { useDownloadsData } from "./useDownloadsData";
import type { DownloadRow } from "./types";

export interface ConsoleDownloadsWidgetProps {
  data: ReturnType<typeof useDownloadsData>;
}

export function ConsoleDownloadsWidget({ data }: ConsoleDownloadsWidgetProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const {
    rows,
    totalActive,
    aggregate,
    keepPanelVisibleForBatch,
    sourcesSyncProgress,
    togglingHash,
    onToggleTorrentPause,
    onCancelTorrent,
    onCancelSource,
    onPauseSource,
    onResumeSource,
  } = data;

  if (totalActive === 0 && !keepPanelVisibleForBatch) return null;

  const visibleRows = rows.length > 0 ? rows.length : keepPanelVisibleForBatch ? 1 : 0;
  const estimatedRowHeightPx = 195;
  const listMaxHeightPx = collapsed ? 0 : Math.min(visibleRows * estimatedRowHeightPx, 520);

  return (
    <div className="pointer-events-none fixed bottom-18 sm:bottom-20 right-6 sm:right-8 z-50 w-md sm:w-lg max-w-[calc(100vw-3rem)]">
      <div className="pointer-events-auto rounded-3xl border border-default-200/60 bg-content1/95 p-5 sm:p-6 shadow-2xl backdrop-blur-xl transition-all duration-200 ease-out">
        {/* Header a escala consola */}
        <DownloadsHeader
          totalActive={totalActive}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          consoleMode
        />

        {/* Barra de progreso global a escala consola */}
        <DownloadsAggregateProgress aggregate={aggregate} consoleMode />

        {/* Lista de filas de descarga a escala consola */}
        <div
          className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
          style={{ maxHeight: `${listMaxHeightPx}px`, opacity: collapsed ? 0 : 1 }}>
          <ScrollShadow hideScrollBar className="max-h-125 space-y-3 pr-1" size={24} orientation="vertical">
            {rows.length === 0 && keepPanelVisibleForBatch ? (
              <div className="flex items-center gap-3.5 rounded-2xl border border-default-200/40 bg-default-50/80 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Download size={22} className="animate-pulse text-primary" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">{t("downloads.preparingNext")}</p>
                  <p className="mt-0.5 text-xs sm:text-sm text-default-400">{t("downloads.batchUploadActive")}</p>
                </div>
              </div>
            ) : null}

            {rows.map((row: DownloadRow) => (
              <DownloadItemRow
                key={row.id}
                row={row}
                consoleMode
                togglingHash={togglingHash}
                sourcesSyncProgress={sourcesSyncProgress}
                onToggleTorrentPause={onToggleTorrentPause}
                onCancelTorrent={onCancelTorrent}
                onCancelSource={onCancelSource}
                onPauseSource={onPauseSource}
                onResumeSource={onResumeSource}
              />
            ))}
          </ScrollShadow>
        </div>
      </div>
    </div>
  );
}
