import { Clock } from "lucide-react";
import type { GameStats } from "@services/tauri";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";

export interface GameCardStatsPanelProps {
  stats: GameStats;
  editionLabel?: string;
}

export function GameCardStatsPanel({ stats, editionLabel }: GameCardStatsPanelProps) {
  return (
    <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md border border-white/10 p-3 flex flex-col justify-center gap-1.5 z-20 translate-y-full group-hover:translate-y-0 transition-transform duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] rounded-xl subpixel-antialiased transform-gpu backface-hidden">
      <div className="flex items-center justify-between text-[10px] text-zinc-400 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] delay-60 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">Guardado:</span>
        <span className="font-bold font-mono text-zinc-200">{formatBytes(stats.localSizeBytes)}</span>
      </div>

      {stats.localLastModified != null && (
        <div className="flex items-center justify-between text-[10px] text-zinc-400 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] delay-100 backface-hidden">
          <span className="font-semibold uppercase tracking-wider text-[8px]">Última vez:</span>
          <span
            className="font-bold text-right truncate max-w-[130px] text-zinc-200"
            title={formatRelativeDate(stats.localLastModified)}>
            {formatRelativeDate(stats.localLastModified).toUpperCase()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-zinc-400 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] delay-140 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">Jugado:</span>
        <div className="flex items-center gap-1 text-primary font-bold font-mono">
          <Clock size={10} className="shrink-0" />
          <span>{formatPlaytime(stats.playtimeSeconds).toUpperCase()}</span>
        </div>
      </div>

      {editionLabel && (
        <div className="border-t border-white/10 pt-1.5 mt-0.5 text-center text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider truncate w-full opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] delay-180 backface-hidden">
          {editionLabel}
        </div>
      )}
    </div>
  );
}
