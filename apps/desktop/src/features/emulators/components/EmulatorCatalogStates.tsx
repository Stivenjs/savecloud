import { Button, Card, CardBody, Skeleton } from "@heroui/react";
import { AlertCircle, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getUnknownErrorMessage } from "@utils/errorMessage";

interface EmulatorCatalogErrorProps {
  error: unknown;
  onRetry: () => void;
}

/** Error de detección de instalaciones con opción para volver a consultar. */
export function EmulatorCatalogError({ error, onRetry }: EmulatorCatalogErrorProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning-400/30 bg-warning-50/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-warning-100/5">
      <p className="flex items-start gap-2 text-xs leading-relaxed text-warning-700 dark:text-warning-300">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <span>
          {t("settings.emulators.statusError")}: {getUnknownErrorMessage(error)}
        </span>
      </p>
      <Button size="sm" variant="flat" color="warning" onPress={onRetry}>
        {t("settings.emulators.retry")}
      </Button>
    </div>
  );
}

/** Mensaje mostrado cuando el filtro no coincide con ningún elemento del catálogo. */
export function EmulatorCatalogEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-default-300/70 px-5 text-center dark:border-default-100/20">
      <Search size={20} className="text-default-400" />
      <p className="mt-3 text-sm font-medium text-foreground">{t("settings.emulators.noResults")}</p>
      <p className="mt-1 text-xs text-default-500">{t("settings.emulators.noResultsHint")}</p>
    </div>
  );
}

/** Skeleton de las fichas mientras se consulta el estado instalado. */
export function EmulatorCatalogSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <Card key={item} className="overflow-hidden border border-default-200/70 dark:border-default-100/15">
          <Skeleton className="h-36 w-full rounded-none sm:h-40" />
          <CardBody className="space-y-4 p-4 sm:p-5">
            <Skeleton className="h-5 w-36 rounded-md" />
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-3 w-2/3 rounded-md" />
            <Skeleton className="h-8 w-32 rounded-lg" />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
