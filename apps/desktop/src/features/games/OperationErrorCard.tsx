import { Button, Card, CardBody } from "@heroui/react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OperationResult } from "@/hooks/useGamesPage";

interface OperationErrorCardProps {
  operationResult: OperationResult;
  /** Cerrar y actualizar lista. */
  onDismiss?: () => void;
  /** Reintentar la misma operación (abre vista previa). */
  onRetry?: (gameId: string, type: "sync" | "download") => void;
}

export function OperationErrorCard({ operationResult, onDismiss, onRetry }: OperationErrorCardProps) {
  const { t } = useTranslation();
  const { type, gameId, result } = operationResult;
  const hasErrors = result.errors.length > 0;

  if (!hasErrors) return null;

  const title = type === "sync" ? t("library.operationError.syncTitle") : t("library.operationError.downloadTitle");
  const canRetry = !!gameId && !!onRetry;

  return (
    <Card className="mt-6 border border-danger-200 bg-danger-50/30 dark:border-danger-800 dark:bg-danger-900/20">
      <CardBody className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-medium text-foreground">{title}</h3>
          <div className="flex shrink-0 gap-2">
            {canRetry && (
              <Button
                size="sm"
                variant="flat"
                color="primary"
                startContent={<RefreshCw size={14} />}
                onPress={() => onRetry(gameId, type)}>
                {t("common.retry")}
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="light" isIconOnly aria-label={t("common.close")} onPress={onDismiss}>
                <X size={16} />
              </Button>
            )}
          </div>
        </div>
        <ul className="list-inside list-disc text-sm text-default-600">
          {result.errors.slice(0, 5).map((err, i) => (
            <li key={i}>{err}</li>
          ))}
          {result.errors.length > 5 && (
            <li>{t("library.operationError.andMore", { count: result.errors.length - 5 })}</li>
          )}
        </ul>
      </CardBody>
    </Card>
  );
}
