import { useCallback, useTransition } from "react";
import { Card, CardBody, Switch } from "@heroui/react";
import { ZapOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { setDisableHardwareAcceleration } from "@services/tauri";
import { toastError } from "@utils/toast";

export function DisableHardwareAccelerationCard() {
  const { config, loading, refetch } = useConfig();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  const onToggle = useCallback(
    (next: boolean) => {
      startTransition(async () => {
        try {
          await setDisableHardwareAcceleration(next);
          void qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
          await refetch();
        } catch (e) {
          toastError((e instanceof Error ? e.message : String(e)) || "No se pudo cambiar la aceleración por hardware");
        }
      });
    },
    [qc, refetch]
  );

  const isEnabled = !!config?.disableHardwareAcceleration;

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ZapOff size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Desactivar aceleración por hardware</h2>
              <p className="mt-0.5 text-sm text-default-500">
                Desactiva el uso de la GPU para renderizar la interfaz. Puede solucionar problemas de parpadeos,
                pantalla negra o incompatibilidad del controlador de gráficos.
                <span className="block mt-1 font-semibold text-warning text-xs uppercase tracking-wider">
                  * Requiere reiniciar la aplicación para aplicar los cambios.
                </span>
              </p>
            </div>
          </div>
          <Switch
            isSelected={isEnabled}
            onValueChange={onToggle}
            isDisabled={loading || pending}
            aria-label="Desactivar aceleración por hardware"
          />
        </div>
      </CardBody>
    </Card>
  );
}
