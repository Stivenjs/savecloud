import { Clock } from "lucide-react";
import type { GameStats } from "@services/tauri";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useTranslation } from "react-i18next";

export interface GameCardStatsPanelProps {
  stats: GameStats;
  editionLabel?: string;
}

export function GameCardStatsPanel({ stats, editionLabel }: GameCardStatsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center gap-1.5 rounded-xl bg-zinc-950/95 p-3 opacity-0 translate-y-full transform-gpu transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] subpixel-antialiased backface-hidden group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0">
      <div className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">{t("library.gameCardStats.saved")}</span>
        <span className="font-bold font-mono text-zinc-200">{formatBytes(stats.localSizeBytes)}</span>
      </div>

      {stats.localLastModified != null && (
        <div className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
          <span className="font-semibold uppercase tracking-wider text-[8px]">
            {t("library.gameCardStats.lastTime")}
          </span>
          <span
            className="font-bold text-right truncate max-w-32.5 text-zinc-200"
            title={formatRelativeDate(stats.localLastModified)}>
            {formatRelativeDate(stats.localLastModified).toUpperCase()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">{t("library.gameCardStats.played")}</span>
        <div className="flex items-center gap-1 text-primary font-bold font-mono">
          <Clock size={10} className="shrink-0" />
          <span>{formatPlaytime(stats.playtimeSeconds).toUpperCase()}</span>
        </div>
      </div>

      {editionLabel && (
        <div className="border-t border-white/10 pt-1.5 mt-0.5 text-center text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider truncate w-full backface-hidden">
          {editionLabel}
        </div>
      )}
    </div>
  );
}
