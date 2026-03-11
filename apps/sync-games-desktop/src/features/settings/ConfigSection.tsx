import { Button, Card, CardBody } from "@heroui/react";
import { FileJson, Cloud, HardDrive, FolderOpen, Zap } from "lucide-react";

interface ConfigSectionProps {
  exporting: boolean;
  importing: boolean;
  backingUpConfig: boolean;
  restoringConfig: boolean;
  configPath: string;
  userId?: string | null;
  /** "accelerated" = S3 Transfer Acceleration activo; "standard" = endpoint estándar; "unknown" o null = no comprobado. */
  s3TransferEndpointType?: "accelerated" | "standard" | "unknown" | null;
  onCreateConfig: () => void;
  onExport: () => void | Promise<void>;
  onImportMerge: () => void | Promise<void>;
  onImportReplace: () => void | Promise<void>;
  onBackupToCloud: () => void | Promise<void>;
  onRestoreFromCloud: () => void | Promise<void>;
}

export function ConfigSection({
  exporting,
  importing,
  backingUpConfig,
  restoringConfig,
  configPath,
  userId,
  s3TransferEndpointType,
  onCreateConfig,
  onExport,
  onImportMerge,
  onImportReplace,
  onBackupToCloud,
  onRestoreFromCloud,
}: ConfigSectionProps) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <FileJson size={22} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">
            Archivo de configuración y respaldos
          </h2>
        </div>
        <p className="text-sm text-default-600">
          Aquí se gestiona tu <strong>config.json</strong>: ruta, crear/editar,
          exportar e importar en tu PC, y respaldar o restaurar desde la nube.
        </p>

        {s3TransferEndpointType != null && s3TransferEndpointType !== "unknown" ? (
          <div className="flex items-center gap-2 rounded-lg border border-default-200 bg-default-50/50 px-3 py-2">
            <Zap size={18} className="text-warning" />
            <span className="text-sm text-default-700">
              Transferencia S3:{" "}
              <strong>
                {s3TransferEndpointType === "accelerated"
                  ? "Acelerada"
                  : "Estándar"}
              </strong>
            </span>
          </div>
        ) : null}

        {/* Ruta y User ID */}
        {configPath ? (
          <div className="space-y-3 rounded-lg border border-default-200 bg-default-50/50 p-4">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-default-500" />
              <span className="text-sm font-medium text-default-700">
                Ruta del archivo
              </span>
            </div>
            <p className="break-all font-mono text-xs text-default-600">
              {configPath}
            </p>
            <p className="text-xs text-default-500">
              La app solo lee <code className="rounded bg-default-200 px-1">config.json</code> desde
              esta carpeta. Si te enviaron un JSON, usa &quot;Importar
              (reemplazar)&quot; más abajo.
            </p>
            {userId ? (
              <div className="pt-2 border-t border-default-200">
                <span className="text-xs font-medium text-default-500">
                  Tu User ID:{" "}
                </span>
                <span className="font-mono text-sm text-foreground">
                  {userId}
                </span>
                <p className="mt-1 text-xs text-default-500">
                  Comparte este ID con amigos para que puedan ver tu perfil en la
                  pestaña Amigos (o usa un link de compartir desde el juego).
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Configurar Conexión */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-default-700">
            Configurar conexión a la nube
          </p>
          <p className="text-xs text-default-500">
            Ingresa tu URL de API, API Key y User ID para habilitar las
            funciones en la nube, o para recuperar tu configuración previa al estar en un PC nuevo.
          </p>
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={onCreateConfig}
            startContent={<Cloud size={16} />}
          >
            Configurar conexión
          </Button>
        </div>

        {/* Exportar / Importar (local) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-default-500" />
            <p className="text-sm font-medium text-default-700">
              Exportar / Importar (archivo en tu PC)
            </p>
          </div>
          <p className="text-xs text-default-500">
            <strong>Exportar:</strong> guarda tu lista de juegos y rutas en un
            JSON en la ubicación que elijas. <strong>Importar (fusionar):</strong>{" "}
            añade los juegos del JSON sin borrar los que ya tienes.{" "}
            <strong>Importar (reemplazar):</strong> sustituye toda tu
            configuración por el contenido del JSON (útil si te pasaron un
            config.json completo).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="flat" onPress={onExport} isLoading={exporting}>
              Exportar
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={onImportMerge}
              isLoading={importing}
            >
              Importar (fusionar)
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="warning"
              onPress={onImportReplace}
              isLoading={importing}
            >
              Importar (reemplazar)
            </Button>
          </div>
        </div>

        {/* Nube */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-default-500" />
            <p className="text-sm font-medium text-default-700">
              Respaldar y restaurar en la nube
            </p>
          </div>
          <p className="text-xs text-default-500">
            <strong>Respaldar en la nube:</strong> sube tu config.json al
            servidor asociado a tu usuario. <strong>Restaurar desde la nube:</strong>{" "}
            descarga la última configuración guardada y la aplica (la app se
            reiniciará).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              color="primary"
              onPress={onBackupToCloud}
              isLoading={backingUpConfig}
            >
              Respaldar en la nube
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              onPress={onRestoreFromCloud}
              isLoading={restoringConfig}
            >
              Restaurar desde la nube
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

