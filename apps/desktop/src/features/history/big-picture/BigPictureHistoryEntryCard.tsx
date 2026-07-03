import { Card, CardBody, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { OperationLogEntry } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
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

  return (
    <Card
      className={
        hasErrors
          ? "border border-warning-300/80 bg-warning-50/40 dark:border-warning-500/40 dark:bg-warning-500/10"
          : undefined
      }>
      <CardBody className="flex flex-col gap-3 p-4 text-base sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-default-100 text-default-600 dark:bg-default-50/10">
              <Icon size={22} />
            </span>
            <Chip size="md" color={chipColor} variant="flat" className="text-sm font-medium">
              {formatOperationLogKind(entry.kind)}
            </Chip>
            {hasErrors ? (
              <Chip size="md" color="warning" variant="flat" className="text-sm font-medium">
                {t("history.entry.errors", { count: entry.errCount })}
              </Chip>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {relative ? <span className="text-sm font-semibold text-foreground">{relative}</span> : null}
            <span className="text-sm text-default-500">{formatOperationLogTimestamp(entry.timestamp)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-default-500">
          <span>
            {formatGameDisplayName(entry.gameId)}
            <span className="ml-1.5 font-mono text-default-400">({entry.gameId})</span>
          </span>
          <span>
            {t("history.entry.filesOk", { count: entry.fileCount })}
            {entry.errCount > 0 ? t("history.entry.filesWithErrors", { count: entry.errCount }) : ""}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
