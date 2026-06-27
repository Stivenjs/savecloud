import { Clock } from "lucide-react";
import type { GameStats } from "@services/tauri";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";

export interface GameCardStatsPanelProps {
  stats: GameStats;
  editionLabel?: string;
}

export function GameCardStatsPanel({ stats, editionLabel }: GameCardStatsPanelProps) {
  return (
    <div className="absolute inset-0 bg-[#0d0e12]/95 border-t border-white/5 p-3 flex flex-col justify-center gap-1.5 z-20 translate-y-full group-hover:translate-y-0 transition-transform duration-350 ease-out rounded-xl subpixel-antialiased">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span className="font-semibold uppercase tracking-wider text-[8px]">Guardado:</span>
        <span className="font-bold font-mono text-zinc-200">{formatBytes(stats.localSizeBytes)}</span>
      </div>

      {stats.localLastModified != null && (
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span className="font-semibold uppercase tracking-wider text-[8px]">Última vez:</span>
          <span
            className="font-bold text-right truncate max-w-[130px] text-zinc-200"
            title={formatRelativeDate(stats.localLastModified)}>
            {formatRelativeDate(stats.localLastModified).toUpperCase()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span className="font-semibold uppercase tracking-wider text-[8px]">Jugado:</span>
        <div className="flex items-center gap-1 text-primary font-bold font-mono">
          <Clock size={10} className="shrink-0" />
          <span>{formatPlaytime(stats.playtimeSeconds).toUpperCase()}</span>
        </div>
      </div>

      {editionLabel && (
        <div className="border-t border-white/5 pt-1.5 mt-0.5 text-center text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider truncate w-full">
          {editionLabel}
        </div>
      )}
    </div>
  );
}
