import { Button, Card, CardBody, Switch } from "@heroui/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Code2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { closeWebviewDevtools, openWebviewDevtools } from "@services/tauri/system.service";
import { toastError } from "@utils/toast";

interface DeveloperModeCardProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void | Promise<void>;
}

export function DeveloperModeCard({ enabled, onEnabledChange }: DeveloperModeCardProps) {
  const [devtoolsBusy, setDevtoolsBusy] = useState<"open" | "close" | null>(null);

  const devtoolsActionsUnlocked = import.meta.env.DEV || enabled;

  const runDevtools = async (kind: "open" | "close") => {
    if (!isTauri()) return;
    setDevtoolsBusy(kind);
    const label = getCurrentWebviewWindow().label;
    try {
      if (kind === "open") {
        await openWebviewDevtools(label);
      } else {
        await closeWebviewDevtools(label);
      }
    } catch (e) {
      toastError(
        kind === "open" ? "No se pudo abrir DevTools" : "No se pudo cerrar DevTools",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setDevtoolsBusy(null);
    }
  };

  return (
    <Card className="bg-default-50">
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Code2 size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Modo desarrollador</h2>
              <p className="mt-1 text-sm text-default-500">
                Se guarda en el perfil activo. En la app instalada desbloquea el inspector del webview (DevTools),
                atajos como F12 / Ctrl+Shift+I y el menú contextual; también muestra las herramientas para plugins (SDK
                Lua, logs).
              </p>
              {import.meta.env.DEV ? (
                <p className="mt-2 text-[11px] leading-snug text-default-400">
                  En `vite` el inspector suele estar ya disponible; el interruptor afecta sobre todo a builds de
                  producción y a lo que queda guardado en el perfil.
                </p>
              ) : null}
            </div>
          </div>
          <Switch
            className="shrink-0"
            isSelected={enabled}
            onValueChange={onEnabledChange}
            aria-label="Modo desarrollador"
          />
        </div>

        <div className="flex flex-wrap gap-2 border-t border-default-200/70 pt-3 dark:border-default-100/15">
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<PanelRightOpen size={16} />}
            isDisabled={!devtoolsActionsUnlocked}
            isLoading={devtoolsBusy === "open"}
            onPress={() => void runDevtools("open")}>
            Abrir DevTools (esta ventana)
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<PanelRightClose size={16} />}
            isDisabled={!devtoolsActionsUnlocked}
            isLoading={devtoolsBusy === "close"}
            onPress={() => void runDevtools("close")}>
            Cerrar DevTools
          </Button>
          {!devtoolsActionsUnlocked ? (
            <p className="w-full text-[11px] text-default-400">
              Activa el modo arriba para usar DevTools en producción.
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
