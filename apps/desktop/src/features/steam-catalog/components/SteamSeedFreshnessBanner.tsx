import { Button, Skeleton } from "@heroui/react";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { useSteamSeedFreshness } from "@features/steam-catalog/hooks/useSteamSeedFreshness";
import { useTranslation } from "react-i18next";

function messageForStatus(
  status: string,
  error: string | null,
  t: (key: string) => string
): { text: string; tone: "success" | "warning" | "neutral" | "danger" } {
  switch (status) {
    case "up_to_date":
      return {
        text: t("steamCatalog.freshness.upToDate"),
        tone: "success",
      };
    case "stale":
      return {
        text: t("steamCatalog.freshness.stale"),
        tone: "warning",
      };
    case "no_local_import":
      return {
        text: t("steamCatalog.freshness.noLocalImport"),
        tone: "warning",
      };
    case "no_cloud_batches":
      return {
        text: t("steamCatalog.freshness.noCloudBatches"),
        tone: "neutral",
      };
    case "unknown":
    default:
      return {
        text: error?.trim() || t("steamCatalog.freshness.unknown"),
        tone: "danger",
      };
  }
}

/** Fondos y texto con contraste WCAG-friendly en claro y oscuro (evitar warning-100 sobre warning-950/25). */
const toneClass: Record<"success" | "warning" | "neutral" | "danger", string> = {
  success:
    "border border-success-300/90 bg-success-100 text-zinc-900 dark:border-success-500/50 dark:bg-success-950/85 dark:text-green-50",
  warning:
    "border border-amber-400/70 bg-amber-50 text-zinc-900 dark:border-amber-400/55 dark:bg-amber-950/90 dark:text-amber-50",
  neutral:
    "border border-default-300 bg-default-100 text-default-900 dark:border-default-200 dark:bg-default-100/90 dark:text-foreground",
  danger:
    "border border-danger-300/90 bg-danger-100 text-zinc-900 dark:border-danger-500/45 dark:bg-danger-950/90 dark:text-red-50",
};

const toneBar: Record<"success" | "warning" | "neutral" | "danger", string> = {
  success: "border-l-4 border-l-success-500",
  warning: "border-l-4 border-l-amber-400",
  neutral: "border-l-4 border-l-default-400",
  danger: "border-l-4 border-l-danger-500",
};

const iconClass: Record<"success" | "warning" | "neutral" | "danger", string> = {
  success: "text-green-700 dark:text-green-300",
  warning: "text-amber-800 dark:text-amber-300",
  neutral: "text-default-600 dark:text-default-400",
  danger: "text-red-700 dark:text-red-300",
};

export function SteamSeedFreshnessBanner() {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, refetch } = useSteamSeedFreshness();

  if (isLoading) {
    return <Skeleton className="h-14 w-full max-w-3xl rounded-medium" />;
  }

  if (!data) {
    return null;
  }

  const { text, tone } = messageForStatus(data.status, data.error, t);
  const Icon =
    data.status === "up_to_date" ? CheckCircle2 : data.status === "no_cloud_batches" ? CloudOff : AlertTriangle;

  return (
    <div
      className={`
      flex max-w-3xl flex-wrap items-start gap-3 
      rounded-medium px-4 py-3 text-sm leading-relaxed shadow-sm
      ${toneClass[tone]} ${toneBar[tone]}
      transition-all duration-300
        `}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${iconClass[tone]}`} aria-hidden strokeWidth={2} />
      <p className="min-w-0 flex-1 font-medium text-[13px] leading-relaxed">{text}</p>
      <Button
        size="sm"
        variant="flat"
        color={
          tone === "warning" ? "warning" : tone === "danger" ? "danger" : tone === "success" ? "success" : "default"
        }
        className="shrink-0 font-semibold"
        isLoading={isFetching}
        startContent={!isFetching ? <RefreshCw size={14} strokeWidth={2.25} /> : undefined}
        onPress={() => void refetch()}>
        {t("steamCatalog.freshness.retry")}
      </Button>
    </div>
  );
}
