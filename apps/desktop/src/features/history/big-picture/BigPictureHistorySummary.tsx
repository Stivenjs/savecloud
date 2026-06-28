import { Card, CardBody } from "@heroui/react";
import { formatOperationLogTimestamp, type OperationLogSummary } from "@utils/operationHistory";

interface BigPictureHistorySummaryProps extends OperationLogSummary {}

/**
 * Resumen de historial optimizado para Big Picture.
 *
 * Texto y padding más generosos que la versión desktop
 * para lectura cómoda desde el sofá.
 */
export function BigPictureHistorySummary({ total, byKind, lastTimestamp }: BigPictureHistorySummaryProps) {
  const lastLabel = lastTimestamp ? formatOperationLogTimestamp(lastTimestamp) : null;

  return (
    <Card className="border border-default-200/80 bg-default-50/50 dark:border-default-100/20 dark:bg-default-50/10">
      <CardBody className="flex flex-col gap-2 px-5 py-4 text-base sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <p className="text-default-600">
          <span className="font-semibold text-foreground">{total}</span> operacion{total === 1 ? "" : "es"} en total
          {lastLabel ? (
            <>
              {" "}
              · última: <span className="text-default-700 dark:text-default-400">{lastLabel}</span>
            </>
          ) : null}
        </p>
        <p className="text-sm text-default-500">
          Subidas {byKind.upload} · Descargas {byKind.download} · Copias amigo {byKind.copy_friend}
        </p>
      </CardBody>
    </Card>
  );
}
