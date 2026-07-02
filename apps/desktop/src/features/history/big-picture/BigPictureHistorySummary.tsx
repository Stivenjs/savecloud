import { Card, CardBody } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { formatOperationLogTimestamp, type OperationLogSummary } from "@utils/operationHistory";

interface BigPictureHistorySummaryProps extends OperationLogSummary {}

export function BigPictureHistorySummary({ total, byKind, lastTimestamp }: BigPictureHistorySummaryProps) {
  const { t } = useTranslation();
  const lastLabel = lastTimestamp ? formatOperationLogTimestamp(lastTimestamp) : null;

  return (
    <Card className="border border-default-200/80 bg-default-50/50 dark:border-default-100/20 dark:bg-default-50/10">
      <CardBody className="flex flex-col gap-2 px-5 py-4 text-base sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <p className="text-default-600">
          {t("history.summary.total", { count: total })}
          {lastLabel ? t("history.summary.last", { date: lastLabel }) : null}
        </p>
        <p className="text-sm text-default-500">
          {t("history.summary.breakdown", {
            upload: byKind.upload,
            download: byKind.download,
            copyFriend: byKind.copy_friend,
          })}
        </p>
      </CardBody>
    </Card>
  );
}
