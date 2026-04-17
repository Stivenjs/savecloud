import { Chip } from "@heroui/react";
import { AlertTriangle, Calendar, CloudCheck } from "lucide-react";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import type { GameStats } from "@services/tauri";
import { GameDetailActions, type GameDetailActionsProps } from "./GameDetailActions";

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-30 flex-col gap-0.5">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-default-400">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export interface GameDetailActionStripProps extends GameDetailActionsProps {
  stats: GameStats | null;
}

export function GameDetailActionStrip({ stats, isGameRunning, ...actionsProps }: GameDetailActionStripProps) {
  const hasMeta = isGameRunning || !!stats;
  const hasActions = Boolean(
    actionsProps.onPlay || actionsProps.onOpenGraph || actionsProps.onEdit || actionsProps.onRemove
  );

  if (!hasActions && !hasMeta) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-default-200/70 bg-default-100/95 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-default-100/20 dark:bg-default-50/15 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <GameDetailActions isGameRunning={isGameRunning} {...actionsProps} />
      </div>

      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-default-200/60 pt-3 lg:border-t-0 lg:pt-0 dark:border-default-100/15">
          {isGameRunning && (
            <Chip startContent={<AlertTriangle size={14} />} color="success" variant="flat" size="sm">
              En ejecución
            </Chip>
          )}

          {stats && (
            <>
              <StatBlock label="Tamaño local" value={formatBytes(stats.localSizeBytes)} />
              <StatBlock label="Tiempo jugado" value={formatPlaytime(stats.playtimeSeconds)} />
              {stats.localLastModified && (
                <div className="flex min-w-30 items-start gap-2 text-sm text-default-600">
                  <Calendar size={16} className="mt-0.5 shrink-0 text-secondary" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-default-400">
                      Modificado
                    </span>
                    <span className="font-medium tabular-nums">{formatRelativeDate(stats.localLastModified)}</span>
                  </div>
                </div>
              )}
              {stats.cloudLastModified && (
                <div className="flex min-w-30 items-start gap-2 text-sm text-default-600">
                  <CloudCheck size={16} className="mt-0.5 shrink-0 text-success" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-default-400">Nube</span>
                    <span className="font-medium tabular-nums">{formatRelativeDate(stats.cloudLastModified)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
