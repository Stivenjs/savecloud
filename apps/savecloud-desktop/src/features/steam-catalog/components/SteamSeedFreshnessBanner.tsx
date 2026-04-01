import { Button, Skeleton } from "@heroui/react";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { useSteamSeedFreshness } from "@features/steam-catalog/hooks/useSteamSeedFreshness";

function messageForStatus(
  status: string,
  error: string | null
): { text: string; tone: "success" | "warning" | "neutral" | "danger" } {
  switch (status) {
    case "up_to_date":
      return {
        text: "Tu catálogo local está al día con los datos que genera el worker en la nube.",
        tone: "success",
      };
    case "stale":
      return {
        text: "Hay datos nuevos en la nube. Pulsa «Descargar información detallada» en Configuración para actualizar.",
        tone: "warning",
      };
    case "no_local_import":
      return {
        text: "Aún no has descargado la información detallada desde la nube. Hazlo desde Configuración con «Descargar información detallada».",
        tone: "warning",
      };
    case "no_cloud_batches":
      return {
        text: "En la nube no hay lotes de datos enriquecidos aún (el worker no ha escrito batches o no hay manifest).",
        tone: "neutral",
      };
    case "unknown":
    default:
      return {
        text: error?.trim() || "No se pudo comprobar el estado (sin conexión, sesión o servicio no disponible).",
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

const iconClass: Record<"success" | "warning" | "neutral" | "danger", string> = {
  success: "text-green-700 dark:text-green-300",
  warning: "text-amber-800 dark:text-amber-300",
  neutral: "text-default-600 dark:text-default-400",
  danger: "text-red-700 dark:text-red-300",
};

export function SteamSeedFreshnessBanner() {
  const { data, isLoading, isFetching, refetch } = useSteamSeedFreshness();

  if (isLoading) {
    return <Skeleton className="h-14 w-full max-w-3xl rounded-medium" />;
  }

  if (!data) {
    return null;
  }

  const { text, tone } = messageForStatus(data.status, data.error);
  const Icon =
    data.status === "up_to_date" ? CheckCircle2 : data.status === "no_cloud_batches" ? CloudOff : AlertTriangle;

  return (
    <div
      className={`flex max-w-3xl flex-wrap items-start gap-3 rounded-medium px-3 py-3 text-sm leading-relaxed shadow-sm ${toneClass[tone]}`}
      role="status"
      aria-live="polite">
      <Icon className={`mt-0.5 size-4.5 shrink-0 ${iconClass[tone]}`} aria-hidden strokeWidth={2.25} />
      <p className="min-w-0 flex-1 font-medium">{text}</p>
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
        Reintentar
      </Button>
    </div>
  );
}
