import { Calendar, CloudCheck } from "lucide-react";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useGameSessionDuration } from "@store/GameSessionStore";
import type { GameStats } from "@services/tauri";
import { GameDetailActions, type GameDetailActionsProps } from "./GameDetailActions";
import { useTranslation } from "react-i18next";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-default-400 truncate">{label}</span>
      <span className="text-[0.8125rem] font-semibold tabular-nums text-foreground leading-tight truncate">
        {value}
      </span>
    </div>
  );
}

export interface GameDetailActionStripProps extends GameDetailActionsProps {
  stats: GameStats | null;
}

export function GameDetailActionStrip({ stats, isGameRunning, ...actionsProps }: GameDetailActionStripProps) {
  const { t } = useTranslation();
  const { formattedDuration } = useGameSessionDuration({
    gameId: stats?.gameId,
    isRunning: isGameRunning,
  });

  const hasMeta = !!stats;
  const hasActions = Boolean(
    actionsProps.onPlay ||
    actionsProps.onInstall ||
    actionsProps.onOpenGraph ||
    actionsProps.onEdit ||
    actionsProps.onRemove
  );

  if (!hasActions && !hasMeta) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <GameDetailActions isGameRunning={isGameRunning} {...actionsProps} />
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {isGameRunning && (
            <div className="flex items-center gap-2">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400">
                  {t("library.detail.inSession", { defaultValue: "En sesión" })}
                </span>
                <span className="text-[0.8125rem] font-semibold tabular-nums text-emerald-500 leading-tight">
                  {formattedDuration}
                </span>
              </div>
            </div>
          )}

          <StatTile label={t("library.localSize")} value={formatBytes(stats!.localSizeBytes)} />
          <StatTile label={t("library.playtime")} value={formatPlaytime(stats!.playtimeSeconds)} />

          {stats!.localLastModified && (
            <div className="flex items-start gap-1.5">
              <Calendar size={13} className="mt-0.75 shrink-0 text-default-300" strokeWidth={1.5} />
              <StatTile label={t("library.modified")} value={formatRelativeDate(stats!.localLastModified)} />
            </div>
          )}

          {stats!.cloudLastModified && (
            <div className="flex items-start gap-1.5">
              <CloudCheck size={13} className="mt-0.75 shrink-0 text-default-300" strokeWidth={1.5} />
              <StatTile label={t("library.cloud")} value={formatRelativeDate(stats!.cloudLastModified)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
