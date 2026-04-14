import { Card, CardBody, Switch } from "@heroui/react";
import { Beaker } from "lucide-react";

interface ExperimentalFeaturesCardProps {
  fullBackupStreaming: boolean;
  onFullBackupStreamingChange: (enabled: boolean) => void;
  fullBackupStreamingDryRun: boolean;
  onFullBackupStreamingDryRunChange: (enabled: boolean) => void;
}

export function ExperimentalFeaturesCard({
  fullBackupStreaming,
  onFullBackupStreamingChange,
  fullBackupStreamingDryRun,
  onFullBackupStreamingDryRunChange,
}: ExperimentalFeaturesCardProps) {
  return (
    <Card className="border border-default-200 bg-default-50/30">
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Beaker size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Funciones experimentales</h2>
              <p className="mt-0.5 text-sm text-default-500">
                Opciones avanzadas para mejorar rendimiento. Úsalas si sabes lo que haces.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-default-700">Backup completo en streaming (sin .tar temporal)</p>
              <p className="mt-0.5 text-xs text-default-500">
                Sube el backup completo sin escribir el archivo <code>.tar</code> al disco. Puede acelerar juegos
                grandes. En este modo el progreso no muestra porcentaje y no soporta “Pausar/Reanudar”.
              </p>
            </div>
            <Switch isSelected={fullBackupStreaming} onValueChange={onFullBackupStreamingChange} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-default-700">Modo prueba (streaming sin subir a la nube)</p>
              <p className="mt-0.5 text-xs text-default-500">
                Genera el backup en streaming y mide el rendimiento, pero <strong>no crea objetos en la nube</strong>.
                Solo para pruebas locales; el backup no queda guardado en S3.
              </p>
            </div>
            <Switch isSelected={fullBackupStreamingDryRun} onValueChange={onFullBackupStreamingDryRunChange} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
