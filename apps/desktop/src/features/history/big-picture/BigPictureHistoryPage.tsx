import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

export function BigPictureHistoryPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const popLayer = useNavigationStore((s) => s.popLayer);

  useRegisterGlobalBack(() => {
    popLayer();
    return true;
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
      <div className="mt-4 flex flex-col gap-2 sm:mt-6">
        <div className="flex flex-wrap items-center gap-3 gap-y-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-[1.875rem]">{t("history.title")}</h1>
        </div>
        <p className="text-sm text-default-400 md:text-base">{t("history.subtitle")}</p>
      </div>

      {!isLoading && !error && summary ? <BigPictureHistorySummary {...summary} /> : null}

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
          <Tab key="all" title={t("history.tabs.all")} />
          <Tab key="upload" title={t("history.tabs.upload")} />
          <Tab key="download" title={t("history.tabs.download")} />
          <Tab key="copy_friend" title={t("history.tabs.copyFriend")} />
        </Tabs>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-4">
          <Spinner size="lg" color="primary" />
          <p className="text-base text-default-500">{t("history.loading")}</p>
        </div>
      ) : null}

      {error && !isLoading ? (
        <Card>
          <CardBody>
            <p className="text-base text-danger">
              {t("history.error")}: {error instanceof Error ? error.message : t("history.unknownError")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!isLoading && !error && entries.length === 0 && allEntries.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
            <History size={48} className="text-default-400" />
            <p className="text-base text-default-500">{t("history.emptyDetailed")}</p>
          </CardBody>
        </Card>
      ) : null}

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

      {!isLoading && !error && allEntries.length > 0 && entries.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-base text-default-500">{t("history.emptyFilter")}</CardBody>
        </Card>
      ) : null}
    </div>
  );
}
