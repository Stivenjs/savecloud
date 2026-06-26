import { useCallback, useTransition } from "react";
import { Card, CardBody, Switch } from "@heroui/react";
import { Cpu } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { setLowPerformanceMode } from "@services/tauri";
import { toastError } from "@utils/toast";

export function LowPerformanceModeCard() {
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
              <h2 className="text-base font-semibold text-foreground">Modo bajo rendimiento</h2>
              <p className="mt-0.5 text-sm text-default-500">
                Desactiva transiciones de interfaz, efectos visuales de desenfoque (blur), vídeos automáticos en el
                catálogo/perfiles y componentes WebGL interactivos. Recomendado para equipos con GPU integrada,
                portátiles con batería o PCs antiguas.
              </p>
            </div>
          </div>
          <Switch
            isSelected={isEnabled}
            onValueChange={onToggle}
            isDisabled={loading || pending}
            aria-label="Activar modo bajo rendimiento"
          />
        </div>
      </CardBody>
    </Card>
  );
}
