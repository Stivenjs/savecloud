import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Monitor } from "lucide-react";
import { useBigPictureMode } from "@/hooks/useBigPictureMode";

export function BigPictureModeCard() {
  const { isDesktop, loading, saving, toggleBusy, startupMode, mainFullscreen, changeStartupMode, toggleNow } =
    useBigPictureMode();

  if (!isDesktop) {
    return null;
  }

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start gap-3">
          <Monitor size={20} className="mt-0.5 shrink-0 text-default-500" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Modo Big Picture</h2>
              <p className="mt-0.5 text-sm text-default-500">
                Misma interfaz en pantalla completa, estilo Steam Big Picture. Puedes salir con Escape o el botón de
                abajo.
              </p>
              <p className="mt-1 text-xs text-default-400">
                Si guardas arranque en Big Picture, mantén pulsado <strong className="font-medium">Shift</strong>,{" "}
                <strong className="font-medium">Ctrl</strong> o <strong className="font-medium">Alt</strong> al abrir la
                app (Windows/macOS) para forzar una sola vez en ventana normal sin cambiar la preferencia.
              </p>
            </div>

            <Select
              label="Al iniciar Savecloud"
              selectedKeys={new Set([startupMode])}
              onSelectionChange={(keys) => {
                const raw = Array.from(keys)[0];
                const k = raw != null ? String(raw) : "";
                if (k === "normal" || k === "big_picture") void changeStartupMode(k);
              }}
              isDisabled={loading || saving}
              size="sm"
              variant="bordered"
              className="max-w-md"
              aria-label="Modo de ventana al iniciar la aplicación">
              <SelectItem key="normal" textValue="Ventana normal">
                Ventana normal
              </SelectItem>
              <SelectItem key="big_picture" textValue="Big Picture (pantalla completa)">
                Big Picture (pantalla completa)
              </SelectItem>
            </Select>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                color="primary"
                variant="flat"
                isLoading={toggleBusy}
                onPress={() => void toggleNow()}
                aria-label={mainFullscreen ? "Salir de pantalla completa" : "Entrar en Big Picture ahora"}>
                {mainFullscreen ? "Salir de pantalla completa" : "Entrar en Big Picture ahora"}
              </Button>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
