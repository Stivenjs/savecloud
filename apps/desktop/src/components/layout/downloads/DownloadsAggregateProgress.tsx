import { Progress } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { DownloadsAggregateData } from "./types";

export interface DownloadsAggregateProgressProps {
  aggregate: DownloadsAggregateData;
  consoleMode?: boolean;
}

export function DownloadsAggregateProgress({ aggregate, consoleMode = false }: DownloadsAggregateProgressProps) {
  const { t } = useTranslation();

  return (
    <div className={`rounded-xl bg-default-100/50 ${consoleMode ? "mb-4 p-3.5" : "mb-3 rounded-lg p-2.5"}`}>
      <div className={`mb-2 flex items-center justify-between ${consoleMode ? "text-sm" : "text-xs"}`}>
        <span className="text-default-500 font-medium">{t("downloads.totalProgress")}</span>
        <span className={`font-bold tabular-nums ${consoleMode ? "text-sm text-foreground" : "font-medium"}`}>
          {aggregate.percent}%
        </span>
      </div>
      <Progress
        size={consoleMode ? "md" : "sm"}
        value={aggregate.percent}
        aria-label={t("downloads.aggregateProgressAria")}
        classNames={{
          track: consoleMode ? "h-2 bg-default-200 rounded-full" : "bg-default-200",
          indicator: "bg-gradient-to-r from-primary to-primary-400",
        }}
      />
    </div>
  );
}
