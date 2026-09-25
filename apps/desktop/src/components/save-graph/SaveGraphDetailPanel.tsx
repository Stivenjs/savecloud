import { Card, CardBody } from "@heroui/react";
import { CalendarClock, Gamepad2, Hash, Sparkles } from "lucide-react";
import { formatRelativeDate } from "@utils/format";
import type { SaveGraphNode } from "@app-types/saveGraph";
import { useTranslation } from "react-i18next";

interface SaveGraphDetailPanelProps {
  node: SaveGraphNode | null;
  emptyLabel: string;
}

/**
 * Panel lateral con detalles del nodo seleccionado.
 */
export function SaveGraphDetailPanel({ node, emptyLabel }: SaveGraphDetailPanelProps) {
  const { t } = useTranslation();

  if (!node) {
    return (
      <Card className="border border-divider bg-content1">
        <CardBody className="space-y-3 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
            {t("saveGraph.detail.title")}
          </p>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-divider bg-content2 text-default-500">
              <Sparkles size={18} />
            </span>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">{t("saveGraph.detail.nothingSelected")}</h3>
              <p className="text-sm leading-6 text-default-500">{emptyLabel}</p>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border border-divider bg-content1">
      <CardBody className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
            <Gamepad2 size={18} />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              {t("saveGraph.detail.node")}
            </p>
            <h3 className="truncate text-lg font-semibold text-foreground">{node.title}</h3>
            <p className="text-sm text-default-500">{node.subtitle ?? t("saveGraph.detail.noSubtitle")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] border border-divider bg-content2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              {t("saveGraph.detail.type")}
            </p>
            <p className="mt-1 text-sm font-semibold">{node.kind}</p>
          </div>
          <div className="rounded-[18px] border border-divider bg-content2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              {t("saveGraph.detail.metric")}
            </p>
            <p className="mt-1 text-sm font-semibold">{node.metric ?? t("saveGraph.detail.noMetrics")}</p>
          </div>
          <div className="rounded-[18px] border border-divider bg-content2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              {t("saveGraph.detail.status")}
            </p>
            <p className="mt-1 text-sm font-semibold">{node.status ?? t("saveGraph.detail.noStatus")}</p>
          </div>
          <div className="rounded-[18px] border border-divider bg-content2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              {t("saveGraph.detail.game")}
            </p>
            <p className="mt-1 text-sm font-semibold">{node.gameId ?? t("saveGraph.detail.library")}</p>
          </div>
        </div>

        {node.timestamp ? (
          <div className="flex items-center gap-2 rounded-[18px] border border-divider bg-content2 px-3 py-2 text-sm text-default-600">
            <CalendarClock size={16} className="shrink-0 text-secondary" />
            <span>{formatRelativeDate(node.timestamp)}</span>
            <Hash size={16} className="ml-auto shrink-0 text-default-400" />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
