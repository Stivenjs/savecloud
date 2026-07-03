import { useCallback, useTransition } from "react";
import { Card, CardBody, Switch } from "@heroui/react";
import { Cpu } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { setLowPerformanceMode } from "@services/tauri";
import { toastError } from "@utils/toast";

export function LowPerformanceModeCard() {
  const { t } = useTranslation();
  const { config, loading, refetch } = useConfig();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  const onToggle = useCallback(
    (next: boolean) => {
      startTransition(async () => {
        try {
          await setLowPerformanceMode(next);
          void qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
          await refetch();
        } catch (e) {
          toastError((e instanceof Error ? e.message : String(e)) || "No se pudo cambiar el modo bajo rendimiento");
        }
      });
    },
    [qc, refetch]
  );

  const isEnabled = !!config?.lowPerformanceMode;

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Cpu size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.performance.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.performance.subtitle")}</p>
            </div>
          </div>
          <Switch
            isSelected={isEnabled}
            onValueChange={onToggle}
            isDisabled={loading || pending}
            aria-label={t("settings.performance.ariaLabel")}
          />
        </div>
      </CardBody>
    </Card>
  );
}
