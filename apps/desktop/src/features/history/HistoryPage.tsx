import { useMemo, useState } from "react";
import { Card, CardBody, Chip, Spinner, Tab, Tabs } from "@heroui/react";
import { History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listOperationHistory, type OperationLogEntry } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import {
  OPERATION_LOG_KIND_CHIP_COLOR,
  OPERATION_LOG_KIND_ICON,
  computeOperationLogSummary,
  formatOperationLogKind,
  formatOperationLogRelativeTime,
  formatOperationLogTimestamp,
  groupOperationLogEntriesByDay,
  type OperationLogSummary,
} from "@utils/operationHistory";
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";

type HistoryFilter = "all" | OperationLogEntry["kind"];

interface HistoryEntryCardProps {
  entry: OperationLogEntry;
}

function HistoryEntryCard({ entry }: HistoryEntryCardProps) {
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
      <CardBody className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-medium bg-default-100 text-default-600 dark:bg-default-50/10">
              <Icon size={18} />
            </span>
            <Chip size="sm" color={chipColor} variant="flat">
              {formatOperationLogKind(entry.kind)}
            </Chip>
            {hasErrors ? (
              <Chip size="sm" color="warning" variant="flat">
                {entry.errCount} error{entry.errCount === 1 ? "" : "es"}
              </Chip>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            {relative ? <span className="text-xs font-medium text-foreground">{relative}</span> : null}
            <span className="text-xs text-default-500">{formatOperationLogTimestamp(entry.timestamp)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500">
          <span>
            {formatGameDisplayName(entry.gameId)}
            <span className="ml-1 font-mono text-default-400">({entry.gameId})</span>
          </span>
          <span>
            Archivos: {entry.fileCount} ok
            {entry.errCount > 0 ? ` / ${entry.errCount} con error` : ""}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

interface HistorySummaryProps extends OperationLogSummary {}

function HistorySummary({ total, byKind, lastTimestamp }: HistorySummaryProps) {
  const lastLabel = lastTimestamp ? formatOperationLogTimestamp(lastTimestamp) : null;
  return (
    <Card className="border border-default-200/80 bg-default-50/50 dark:border-default-100/20 dark:bg-default-50/10">
      <CardBody className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <p className="text-default-600">
          <span className="font-medium text-foreground">{total}</span> operacion{total === 1 ? "" : "es"} en total
          {lastLabel ? (
            <>
              {" "}
              · última: <span className="text-default-700 dark:text-default-400">{lastLabel}</span>
            </>
          ) : null}
        </p>
        <p className="text-xs text-default-500">
          Subidas {byKind.upload} · Descargas {byKind.download} · Copias amigo {byKind.copy_friend}
        </p>
      </CardBody>
    </Card>
  );
}

export function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const popLayer = useNavigationStore((s) => s.popLayer);
  useRegisterGlobalBack(() => {
    switch (true) {
      default:
        popLayer();
        return true;
    }
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["operation-history"],
    queryFn: listOperationHistory,
  });

  const allEntries = useMemo(() => [...(data ?? [])].reverse(), [data]);

  const entries = useMemo(
    () => (filter === "all" ? allEntries : allEntries.filter((e) => e.kind === filter)),
    [allEntries, filter]
  );

  const groupedByDay = useMemo(() => groupOperationLogEntriesByDay(entries), [entries]);

  const summary = useMemo(() => computeOperationLogSummary(allEntries), [allEntries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Historial de operaciones</h1>
        <span className="inline-flex h-7 items-center rounded-full bg-default-100 px-3 text-xs text-default-500">
          Subidas, descargas y copias desde amigos
        </span>
      </div>

      {!isLoading && !error && summary ? <HistorySummary {...summary} /> : null}

      {!isLoading && !error && allEntries.length > 0 ? (
        <Tabs
          selectedKey={filter}
          onSelectionChange={(k) => setFilter((k as HistoryFilter) ?? "all")}
          variant="underlined">
          <Tab key="all" title="Todos" />
          <Tab key="upload" title="Subidas" />
          <Tab key="download" title="Descargas" />
          <Tab key="copy_friend" title="Copia amigos" />
        </Tabs>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500">Cargando historial...</p>
        </div>
      ) : null}

      {error && !isLoading ? (
        <Card>
          <CardBody>
            <p className="text-sm text-danger">
              No se pudo cargar el historial: {error instanceof Error ? error.message : "Error desconocido"}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!isLoading && !error && entries.length === 0 && allEntries.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <History size={40} className="text-default-400" />
            <p className="text-default-500">
              Aún no hay operaciones registradas. Cuando subas, descargues o copies guardados desde amigos, aparecerán
              aquí.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!isLoading && !error && entries.length > 0 ? (
        <div className="space-y-6">
          {groupedByDay.map((group) => (
            <section key={group.dayKey} className="space-y-3" aria-labelledby={`history-day-${group.dayKey}`}>
              <h2 id={`history-day-${group.dayKey}`} className="text-sm font-semibold capitalize text-default-600">
                {group.dayLabel}
              </h2>
              <div className="space-y-2">
                {group.entries.map((entry, index) => (
                  <HistoryEntryCard key={`${entry.timestamp}-${entry.gameId}-${entry.kind}-${index}`} entry={entry} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {!isLoading && !error && allEntries.length > 0 && entries.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center text-default-500">
            No hay operaciones de este tipo en el historial.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
