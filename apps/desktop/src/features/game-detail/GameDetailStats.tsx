import { Card, CardBody } from "@heroui/react";
import { Clock, HardDrive, Calendar, CloudCheck } from "lucide-react";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useGameSessionDuration } from "@store/GameSessionStore";
import type { GameStats } from "@services/tauri";

interface GameDetailStatsProps {
  stats: GameStats | null;
  isGameRunning?: boolean;
}

export function GameDetailStats({ stats, isGameRunning }: GameDetailStatsProps) {
  const { formattedDuration } = useGameSessionDuration({
    gameId: stats?.gameId,
    isRunning: isGameRunning,
  });

  if (!stats) return null;

  return (
    <Card className="border border-default-200/60 shadow-sm">
      <CardBody className="flex flex-row flex-wrap items-center gap-4 px-5 py-3">
        {stats && (
          <>
            {isGameRunning && (
              <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-sm text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-medium text-default-400">En sesión:</span>
                <span className="font-semibold">{formattedDuration}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-default-600">
              <HardDrive size={16} className="text-primary" />
              <span className="font-medium">{formatBytes(stats.localSizeBytes)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-default-600">
              <Clock size={16} className="text-warning" />
              <span className="font-medium">{formatPlaytime(stats.playtimeSeconds)}</span>
              <span className="text-default-400">jugado</span>
            </div>

            {stats.localLastModified && (
              <div className="flex items-center gap-2 text-sm text-default-600">
                <Calendar size={16} className="text-secondary" />
                <span className="text-default-400">Modificado:</span>
                <span className="font-medium">{formatRelativeDate(stats.localLastModified)}</span>
              </div>
            )}

            {stats.cloudLastModified && (
              <div className="flex items-center gap-2 text-sm text-default-600">
                <CloudCheck size={16} className="text-success" />
                <span className="text-default-400">Nube:</span>
                <span className="font-medium">{formatRelativeDate(stats.cloudLastModified)}</span>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
