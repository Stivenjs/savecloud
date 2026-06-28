import { useMemo, useState } from "react";
import { Card, CardBody, Spinner, Tab, Tabs } from "@heroui/react";
import { History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listOperationHistory, type OperationLogEntry } from "@services/tauri";
import { computeOperationLogSummary, groupOperationLogEntriesByDay } from "@utils/operationHistory";
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { BigPictureHistoryEntryCard } from "./BigPictureHistoryEntryCard";
import { BigPictureHistorySummary } from "./BigPictureHistorySummary";

type HistoryFilter = "all" | OperationLogEntry["kind"];

/**
 * Versión Big Picture (modo consola) de la página de Actividad.
 *
 * Reutiliza los mismos queries y utilidades que `HistoryPage`,
 * pero con layout, tamaños y espaciado adaptados a pantalla TV/gamepad:
 *
 * - Extra `pb-32` para la barra de control hints inferior.
 * - Top margin `mt-4 sm:mt-6` para despejar el HUD superior.
 * - Tabs y tarjetas más grandes con touch-targets amplios.
 * - Texto con escala legible desde distancia de sofá.
 */
export function BigPictureHistoryPage() {
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
    <div className="space-y-5 pb-32">
      {/* Cabecera */}
      <div className="mt-4 flex flex-col gap-2 sm:mt-6">
        <div className="flex flex-wrap items-center gap-3 gap-y-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-[1.875rem]">
            Historial de operaciones
          </h1>
        </div>
        <p className="text-sm text-default-400 md:text-base">Subidas, descargas y copias desde amigos</p>
      </div>

      {/* Resumen */}
      {!isLoading && !error && summary ? <BigPictureHistorySummary {...summary} /> : null}

      {/* Filtros */}
      {!isLoading && !error && allEntries.length > 0 ? (
        <Tabs
          selectedKey={filter}
          onSelectionChange={(k) => setFilter((k as HistoryFilter) ?? "all")}
          variant="underlined"
          size="lg"
          classNames={{
            tabList: "gap-6",
            tab: "text-base md:text-lg font-semibold px-1 py-3",
            cursor: "h-[3px]",
          }}>
          <Tab key="all" title="Todos" />
          <Tab key="upload" title="Subidas" />
          <Tab key="download" title="Descargas" />
          <Tab key="copy_friend" title="Copia amigos" />
        </Tabs>
      ) : null}

      {/* Loading */}
      {isLoading ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-4">
          <Spinner size="lg" color="primary" />
          <p className="text-base text-default-500">Cargando historial...</p>
        </div>
      ) : null}

      {/* Error */}
      {error && !isLoading ? (
        <Card>
          <CardBody>
            <p className="text-base text-danger">
              No se pudo cargar el historial: {error instanceof Error ? error.message : "Error desconocido"}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* Empty (sin datos) */}
      {!isLoading && !error && entries.length === 0 && allEntries.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
            <History size={48} className="text-default-400" />
            <p className="text-base text-default-500">
              Aún no hay operaciones registradas. Cuando subas, descargues o copies guardados desde amigos, aparecerán
              aquí.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* Lista agrupada por día */}
      {!isLoading && !error && entries.length > 0 ? (
        <div className="space-y-6">
          {groupedByDay.map((group) => (
            <section key={group.dayKey} className="space-y-3" aria-labelledby={`history-day-${group.dayKey}`}>
              <h2
                id={`history-day-${group.dayKey}`}
                className="text-base font-semibold capitalize text-default-600 md:text-lg">
                {group.dayLabel}
              </h2>
              <div className="space-y-3">
                {group.entries.map((entry, index) => (
                  <BigPictureHistoryEntryCard
                    key={`${entry.timestamp}-${entry.gameId}-${entry.kind}-${index}`}
                    entry={entry}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {/* Sin resultados de filtro */}
      {!isLoading && !error && allEntries.length > 0 && entries.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-base text-default-500">
            No hay operaciones de este tipo en el historial.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
