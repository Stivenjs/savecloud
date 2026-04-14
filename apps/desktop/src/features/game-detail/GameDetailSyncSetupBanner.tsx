import { Button, Card, CardBody } from "@heroui/react";
import { CloudOff, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** Aviso en detalle de juego cuando no hay cuenta/API de nube (misma idea que en la lista: acciones de nube no disponibles). */
export function GameDetailSyncSetupBanner() {
  const navigate = useNavigate();

  return (
    <Card className="border border-primary-200/50 bg-primary-50/30 dark:border-primary-500/20 dark:bg-primary-500/5">
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <CloudOff className="mt-0.5 shrink-0 text-primary" size={22} aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">Sincronización con la nube no configurada</p>
            <p className="mt-1 text-sm text-default-600">
              En <strong className="text-foreground">Configuración</strong> puedes enlazar la API y el almacenamiento.
              Hasta entonces no podrás subir, descargar ni compartir guardados; el resto de acciones del juego sigue
              disponible.
            </p>
          </div>
        </div>
        <Button
          color="primary"
          variant="flat"
          className="shrink-0 self-start sm:self-auto"
          startContent={<Settings size={18} />}
          onPress={() => navigate("/settings")}>
          Ir a configuración
        </Button>
      </CardBody>
    </Card>
  );
}
