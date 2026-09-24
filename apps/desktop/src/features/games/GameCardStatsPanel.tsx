import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import type { GameStats } from "@services/tauri";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useTranslation } from "react-i18next";

export interface GameCardStatsPanelProps {
  stats: GameStats;
  editionLabel?: string;
}

/** Fila que entra con fade + micro-desplazamiento, activada por `group/card` (hover o foco). */
const ROW =
  "flex items-center justify-between text-[10px] text-zinc-400 opacity-0 translate-y-1 " +
  "transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none " +
  "group-hover/card:opacity-100 group-hover/card:translate-y-0 " +
  "group-focus-visible/card:opacity-100 group-focus-visible/card:translate-y-0";

// Delays solo al entrar (van dentro del variant), así al salir no se arrastran.
const DELAY = [
  "group-hover/card:delay-60 group-focus-visible/card:delay-60",
  "group-hover/card:delay-110 group-focus-visible/card:delay-110",
  "group-hover/card:delay-160 group-focus-visible/card:delay-160",
  "group-hover/card:delay-210 group-focus-visible/card:delay-210",
] as const;

function Row({ step, className = "", children }: { step: 0 | 1 | 2 | 3; className?: string; children: ReactNode }) {
  return <div className={`${ROW} ${DELAY[step]} ${className}`}>{children}</div>;
}

export function GameCardStatsPanel({ stats, editionLabel }: GameCardStatsPanelProps) {
  const { t } = useTranslation();
  const label = "font-semibold uppercase tracking-wider text-[8px]";

  const sheetMotion =
    "translate-y-full opacity-0 transition-[transform,opacity] duration-150 ease-in " +
    "motion-reduce:transition-none " +
    "group-hover/card:translate-y-0 group-hover/card:opacity-100 group-hover/card:duration-300 " +
    "group-hover/card:delay-50 group-hover/card:ease-[cubic-bezier(0.16,1,0.3,1)] " +
    "group-focus-visible/card:translate-y-0 group-focus-visible/card:opacity-100 " +
    "group-focus-visible/card:duration-300 group-focus-visible/card:delay-50 " +
    "group-focus-visible/card:ease-[cubic-bezier(0.16,1,0.3,1)]";

  const scrimMotion =
    "opacity-0 transition-opacity duration-150 motion-reduce:transition-none " +
    "group-hover/card:opacity-100 group-hover/card:duration-300 " +
    "group-focus-visible/card:opacity-100 group-focus-visible/card:duration-300";

  return (
    <>
      {/* Scrim: oscurece la portada solo con opacity (barato, sin filter) */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 z-10 bg-black/35 ${scrimMotion}`} />

      {/* Wrapper ESTÁTICO que recorta: la hoja se desliza dentro y nunca puede salirse */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 overflow-hidden">
        <div
          className={`flex flex-col gap-1.5 bg-linear-to-t from-[#0e0f14] via-[#0e0f14]/95 to-[#0e0f14]/0 px-3 pb-3 pt-6 ${sheetMotion}`}>
          <Row step={0}>
            <span className={label}>{t("library.gameCardStats.saved")}</span>
            <span className="font-bold font-mono text-zinc-200">{formatBytes(stats.localSizeBytes)}</span>
          </Row>

          {stats.localLastModified != null && (
            <Row step={1}>
              <span className={label}>{t("library.gameCardStats.lastTime")}</span>
              <span
                className="max-w-32.5 truncate text-right font-bold text-zinc-200"
                title={formatRelativeDate(stats.localLastModified)}>
                {formatRelativeDate(stats.localLastModified).toUpperCase()}
              </span>
            </Row>
          )}

          <Row step={2}>
            <span className={label}>{t("library.gameCardStats.played")}</span>
            <div className="flex items-center gap-1 font-mono font-bold text-primary">
              <Clock size={10} className="shrink-0" />
              <span>{formatPlaytime(stats.playtimeSeconds).toUpperCase()}</span>
            </div>
          </Row>

          {editionLabel && (
            <Row
              step={3}
              className="mt-0.5 w-full justify-center truncate border-t border-white/10 pt-1.5 text-[8.5px] font-bold uppercase tracking-wider text-zinc-500">
              {editionLabel}
            </Row>
          )}
        </div>
      </div>
    </>
  );
}
