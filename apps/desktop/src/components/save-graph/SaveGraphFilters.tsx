import { Button } from "@heroui/react";
import { useSaveGraphStore } from "@store/SaveGraphStore";
import { useTranslation } from "react-i18next";

const WINDOWS = [30, 90, 180, 365] as const;

interface SaveGraphFiltersProps {
  onResetSelection?: () => void;
}

/**
 * Filtros compartidos de ventana temporal para el grafo.
 */
export function SaveGraphFilters({ onResetSelection }: SaveGraphFiltersProps) {
  const { t } = useTranslation();
  const windowDays = useSaveGraphStore((state) => state.filters.windowDays);
  const setWindowDays = useSaveGraphStore((state) => state.setWindowDays);
  const reset = useSaveGraphStore((state) => state.reset);

  return (
    <section className="rounded-3xl border border-divider bg-content1 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
            {t("saveGraph.filters.timeWindow")}
          </p>
          <div className="flex flex-wrap gap-2">
            {WINDOWS.map((days) => (
              <Button
                key={days}
                size="sm"
                radius="full"
                color={windowDays === days ? "primary" : "default"}
                variant={windowDays === days ? "solid" : "flat"}
                onPress={() => setWindowDays(days)}>
                {t("saveGraph.filters.days", { count: days })}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 self-start lg:self-auto">
          <Button
            size="sm"
            radius="full"
            variant="flat"
            onPress={() => {
              reset();
              onResetSelection?.();
            }}>
            {t("saveGraph.filters.reset")}
          </Button>
        </div>
      </div>
    </section>
  );
}
