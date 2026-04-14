import { Card, CardBody, Chip } from "@heroui/react";
import { Clock, HardDrive, Calendar, CloudCheck, AlertTriangle } from "lucide-react";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import type { GameStats } from "@services/tauri";

interface GameDetailStatsProps {
  stats: GameStats | null;
  isGameRunning: boolean;
}

export function GameDetailStats({ stats, isGameRunning }: GameDetailStatsProps) {
  if (!stats && !isGameRunning) return null;

  return (
    <Card className="border border-default-200/60 shadow-sm">
      <CardBody className="flex flex-row flex-wrap items-center gap-4 px-5 py-3">
        {isGameRunning && (
          <Chip startContent={<AlertTriangle size={14} />} color="success" variant="flat" size="sm">
            En ejecución
          </Chip>
        )}

        {stats && (
          <>
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
