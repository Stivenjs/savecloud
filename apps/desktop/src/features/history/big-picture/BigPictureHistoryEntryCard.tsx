import { Card, CardBody, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { OperationLogEntry } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";
import {
  OPERATION_LOG_KIND_CHIP_COLOR,
  OPERATION_LOG_KIND_ICON,
  formatOperationLogKind,
  formatOperationLogRelativeTime,
  formatOperationLogTimestamp,
} from "@utils/operationHistory";

interface BigPictureHistoryEntryCardProps {
  entry: OperationLogEntry;
}

export function BigPictureHistoryEntryCard({ entry }: BigPictureHistoryEntryCardProps) {
  const { t } = useTranslation();
  const Icon = OPERATION_LOG_KIND_ICON[entry.kind];
  const chipColor = OPERATION_LOG_KIND_CHIP_COLOR[entry.kind];
  const hasErrors = entry.errCount > 0;
  const relative = formatOperationLogRelativeTime(entry.timestamp);
  const displayName = formatGameDisplayName(entry.gameId);

  return (
    <Card
      className={`transition-all duration-200 border ${
        hasErrors
          ? "border-warning-400/80 bg-warning-950/20"
          : "border-white/10 bg-zinc-900/60 shadow-lg backdrop-blur-md ring-1 ring-white/5"
      }`}>
      <CardBody className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <PlayingGameThumbnail gameId={entry.gameId} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-bold text-foreground">{displayName}</h3>
                {entry.gameId.toLowerCase() !== displayName.toLowerCase() && (
                  <span className="hidden sm:inline-block truncate font-mono text-xs text-default-400">
                    ({entry.gameId})
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm">
                <Chip
                  size="md"
                  color={chipColor}
                  variant="flat"
                  startContent={<Icon size={16} className="ml-1" />}
                  className="gap-1.5 font-medium">
                  {formatOperationLogKind(entry.kind)}
                </Chip>
                <span className="text-default-400">·</span>
                <span className="text-default-400 font-medium">
                  {t("history.entry.filesOk", { count: entry.fileCount })}
                </span>
                {hasErrors ? (
                  <>
                    <span className="text-default-400">·</span>
                    <Chip size="md" color="warning" variant="flat" className="font-semibold">
                      {t("history.entry.errors", { count: entry.errCount })}
                    </Chip>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {relative ? <span className="text-sm font-semibold text-foreground">{relative}</span> : null}
            <span className="text-xs text-default-400 font-mono">{formatOperationLogTimestamp(entry.timestamp)}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
