import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Monitor } from "lucide-react";
import { useBigPictureMode } from "@/hooks/useBigPictureMode";

export function BigPictureModeCard() {
  const { isDesktop, loading, saving, toggleBusy, startupMode, bigPictureActive, changeStartupMode, toggleNow } =
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
                Abre una ventana dedicada Big Picture y oculta la ventana principal en el tray mientras esté activo.
              </p>
              <p className="mt-1 text-xs text-default-400">
                Puedes volver al modo normal desde el botón de abajo o con{" "}
                <strong className="font-medium">Escape</strong> dentro de la ventana Big Picture.
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
                aria-label={bigPictureActive ? "Volver a modo normal" : "Entrar en Big Picture ahora"}>
                {bigPictureActive ? "Volver a modo normal" : "Entrar en Big Picture ahora"}
              </Button>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
