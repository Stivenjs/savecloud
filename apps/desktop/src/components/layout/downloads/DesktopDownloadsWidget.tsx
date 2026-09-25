import { useState } from "react";
import { ScrollShadow } from "@heroui/react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DownloadsHeader } from "./DownloadsHeader";
import { DownloadsAggregateProgress } from "./DownloadsAggregateProgress";
import { DownloadItemRow } from "./DownloadItemRow";
import type { useDownloadsData } from "./useDownloadsData";
import type { DownloadRow } from "./types";

export interface DesktopDownloadsWidgetProps {
  data: ReturnType<typeof useDownloadsData>;
}

export function DesktopDownloadsWidget({ data }: DesktopDownloadsWidgetProps) {
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
  const estimatedRowHeightPx = 168;
  const listMaxHeightPx = collapsed ? 0 : Math.min(visibleRows * estimatedRowHeightPx, 420);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-95 max-w-[90vw]">
      <div className="pointer-events-auto rounded-2xl border border-default-200/60 bg-content1/95 p-4 shadow-xl backdrop-blur-md transition-all duration-200 ease-out">
        {/* Header */}
        <DownloadsHeader
          totalActive={totalActive}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />

        {/* Barra de progreso global */}
        <DownloadsAggregateProgress aggregate={aggregate} />

        {/* Lista de filas de descarga */}
        <div
          className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
          style={{ maxHeight: `${listMaxHeightPx}px`, opacity: collapsed ? 0 : 1 }}>
          <ScrollShadow hideScrollBar className="max-h-105 space-y-2.5 pr-1" size={20} orientation="vertical">
            {rows.length === 0 && keepPanelVisibleForBatch ? (
              <div className="flex items-center gap-3 rounded-xl border border-default-200/40 bg-default-50/80 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Download size={18} className="animate-pulse text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("downloads.preparingNext")}</p>
                  <p className="mt-0.5 text-xs text-default-400">{t("downloads.batchUploadActive")}</p>
                </div>
              </div>
            ) : null}

            {rows.map((row: DownloadRow) => (
              <DownloadItemRow
                key={row.id}
                row={row}
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
