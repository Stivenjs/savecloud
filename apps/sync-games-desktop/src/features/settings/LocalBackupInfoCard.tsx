import { Card, CardBody } from "@heroui/react";
import { Archive } from "lucide-react";

export function LocalBackupInfoCard() {
  return (
    <Card className="border border-default-200 bg-default-50/30">
      <CardBody>
        <div className="flex items-center gap-2">
          <Archive size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">
            Respaldo local automático
          </h2>
        </div>
        <p className="mt-2 text-sm text-default-600">
          Antes de descargar guardados desde la nube, la app crea una copia de
          seguridad en tu PC para no sobrescribir nada sin respaldo. Las copias
          se guardan en la carpeta de configuración:{" "}
          <code className="rounded bg-default-200 px-1 font-mono text-xs">
            sync-games/backups/[juego]/[fecha]
          </code>
        </p>
      </CardBody>
    </Card>
  );
}

