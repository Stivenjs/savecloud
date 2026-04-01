import { Button, Card, CardBody, Divider, Skeleton } from "@heroui/react";
import { FileJson, Cloud, HardDrive, FolderOpen, Link2, Library, Zap } from "lucide-react";

interface ConfigSectionProps {
  exporting: boolean;
  importing: boolean;
  backingUpConfig: boolean;
  restoringConfig: boolean;
  configPath: string;
  userId?: string | null;
  /** True si hay clave Steam Web API (valor enmascarado desde get_config). */
  hasSteamWebApiKey?: boolean;
  /** "accelerated" = S3 Transfer Acceleration activo; "standard" = endpoint estándar; "unknown" o null = no comprobado. */
  s3TransferEndpointType?: "accelerated" | "standard" | "unknown" | null;
  /** Indica si la información principal aún se está cargando (útil para skeletons) */
  isLoadingData?: boolean;
  steamCatalogBusy?: boolean;
  steamSeedBusy?: boolean;
  onCreateConfig: () => void;
  onExport: () => void | Promise<void>;
  onImportMerge: () => void | Promise<void>;
  onImportReplace: () => void | Promise<void>;
  onPullFriendConfig: () => void | Promise<void>;
  onBackupToCloud: () => void | Promise<void>;
  onRestoreFromCloud: () => void | Promise<void>;
  onSyncSteamCatalog?: () => void | Promise<void>;
  onResetSteamCatalogSync?: () => void | Promise<void>;
  onExportSteamSeedManifest?: () => void | Promise<void>;
  onResetCloudSeedState?: () => void | Promise<void>;
  onImportCloudSeedBatches?: () => void | Promise<void>;
}

export function ConfigSection({
  exporting,
  importing,
  backingUpConfig,
  restoringConfig,
  configPath,
  userId,
  hasSteamWebApiKey = false,
  s3TransferEndpointType,
  isLoadingData = false,
  steamCatalogBusy = false,
  steamSeedBusy = false,
  onCreateConfig,
  onExport,
  onImportMerge,
  onImportReplace,
  onPullFriendConfig,
  onBackupToCloud,
  onRestoreFromCloud,
  onSyncSteamCatalog,
  onResetSteamCatalogSync,
  onExportSteamSeedManifest,
  onResetCloudSeedState,
  onImportCloudSeedBatches,
}: ConfigSectionProps) {
  const showS3TransferBlock = isLoadingData || (s3TransferEndpointType != null && s3TransferEndpointType !== "unknown");

  return (
    <Card>
      <CardBody className="flex flex-col gap-0">
        <div className="flex flex-col gap-2 pb-4">
          <div className="flex items-center gap-2">
            <FileJson size={22} className="text-primary" />
            <h2 className="text-base font-semibold text-foreground">Archivo de configuración y respaldos</h2>
          </div>
          <p className="text-sm text-default-600">
            Todo lo relacionado con <strong>config.json</strong>: ubicación, conexión a la nube, copias locales y
            respaldos en el servidor.
          </p>
        </div>

        {showS3TransferBlock ? (
          <>
            <Divider className="mb-5" />
            <section aria-labelledby="config-s3-status">
              <p id="config-s3-status" className="text-xs font-semibold uppercase tracking-wider text-default-500">
                Estado de transferencia
              </p>
              <div className="mt-2">
                {isLoadingData ? (
                  <Skeleton className="h-10 w-full max-w-md rounded-lg" />
                ) : (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-default-200 bg-default-50/50 px-3 py-2">
                    <Zap size={18} className="text-warning" />
                    <span className="text-sm text-default-700">
                      S3: <strong>{s3TransferEndpointType === "accelerated" ? "Acelerada" : "Estándar"}</strong>
                    </span>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}

        <Divider className="my-5" />

        {/* Ruta y usuario */}
        <section aria-labelledby="config-path-user" className="space-y-3">
          <p id="config-path-user" className="text-xs font-semibold uppercase tracking-wider text-default-500">
            Archivo y usuario
          </p>
          <div className="rounded-lg border border-default-200 bg-default-50/50 p-4">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-default-500" />
              <span className="text-sm font-medium text-default-700">Ruta de config.json</span>
            </div>

            {isLoadingData ? (
              <Skeleton className="mt-3 h-4 w-full max-w-xl rounded-lg" />
            ) : configPath ? (
              <p className="mt-2 break-all font-mono text-xs text-default-600">{configPath}</p>
            ) : (
              <p className="mt-2 text-xs text-default-400 italic">Ruta no disponible.</p>
            )}

            <p className="mt-2 text-xs text-default-500">
              La app solo lee <code className="rounded bg-default-200 px-1">config.json</code> aquí. Si recibiste un
              JSON completo, usa &quot;Importar (reemplazar)&quot; más abajo.
            </p>

            <div className="mt-4 border-t border-default-200 pt-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-default-500">Usuario</span>
                {isLoadingData ? (
                  <Skeleton className="h-4 w-32 rounded-lg" />
                ) : userId ? (
                  <span className="font-mono text-sm text-foreground">{userId}</span>
                ) : (
                  <span className="text-xs text-default-400 italic">No configurado</span>
                )}
              </div>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-default-500">
                <Link2 size={14} className="mt-0.5 shrink-0 text-default-400" />
                Compártelo con amigos para el perfil en Amigos, o usa un enlace de compartir desde un juego.
              </p>
            </div>
          </div>
        </section>

        <Divider className="my-5" />

        {/* Conexión */}
        <section aria-labelledby="config-cloud-link" className="space-y-2">
          <p id="config-cloud-link" className="text-xs font-semibold uppercase tracking-wider text-default-500">
            Conexión a la nube
          </p>
          <p className="text-sm text-default-600">
            API, clave y usuario para sincronizar o recuperar la configuración en un equipo nuevo.
          </p>
          <Button size="sm" variant="flat" color="primary" onPress={onCreateConfig} startContent={<Cloud size={16} />}>
            Configurar conexión
          </Button>
        </section>

        <Divider className="my-5" />

        {/* Catálogo de juegos Steam */}
        <section aria-labelledby="config-steam-catalog" className="space-y-3">
          <div className="flex items-center gap-2">
            <Library size={18} className="text-default-500" />
            <p id="config-steam-catalog" className="text-xs font-semibold uppercase tracking-wider text-default-500">
              Catálogo de juegos Steam
            </p>
          </div>
          <p className="text-sm text-default-600">
            Con la misma clave de Steam que indicas en «Configurar conexión», la app descarga y guarda en tu equipo el
            listado de juegos para que puedas buscarlos y ver información. Las siguientes veces solo se actualizan los
            cambios nuevos.
          </p>
          <div className="rounded-lg border border-default-200 bg-default-50/50 px-3 py-2">
            <span className="text-xs font-medium text-default-500">Clave de Steam</span>
            {isLoadingData ? (
              <Skeleton className="mt-1 h-4 w-40 rounded-lg" />
            ) : (
              <p className="mt-1 text-sm text-foreground">
                {hasSteamWebApiKey ? (
                  <span className="text-success-600">Configurada</span>
                ) : (
                  <span className="text-default-400 italic">No configurada — añádela en Configurar conexión</span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              isDisabled={!hasSteamWebApiKey || steamCatalogBusy}
              isLoading={steamCatalogBusy}
              onPress={() => onSyncSteamCatalog?.()}>
              Sincronizar catálogo ahora
            </Button>
            <Button
              size="sm"
              variant="light"
              color="warning"
              isDisabled={steamCatalogBusy}
              onPress={() => onResetSteamCatalogSync?.()}>
              Volver a descargar todo el listado
            </Button>
          </div>
        </section>

        <Divider className="my-5" />

        {/* Seed cloud de Steam */}
        <section aria-labelledby="config-steam-seed" className="space-y-3">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-default-500" />
            <p id="config-steam-seed" className="text-xs font-semibold uppercase tracking-wider text-default-500">
              Seed cloud de Steam
            </p>
          </div>
          <p className="text-sm text-default-600">
            Publica tu listado local de appids en la nube para que el worker de seed lo procese, y permite importar
            lotes enriquecidos a SQLite (también para usuarios invitados conectados al host activo).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              color="primary"
              isDisabled={steamSeedBusy}
              isLoading={steamSeedBusy}
              onPress={() => onExportSteamSeedManifest?.()}>
              Publicar manifest a nube
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              isDisabled={steamSeedBusy}
              onPress={() => onImportCloudSeedBatches?.()}>
              Importar batches a SQLite
            </Button>
            <Button
              size="sm"
              variant="light"
              color="warning"
              isDisabled={steamSeedBusy}
              onPress={() => onResetCloudSeedState?.()}>
              Resetear estado del seed
            </Button>
          </div>
        </section>

        <Divider className="my-5" />

        {/* Local */}
        <section aria-labelledby="config-local-files" className="space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-default-500" />
            <p id="config-local-files" className="text-sm font-semibold text-foreground">
              Archivos en este equipo
            </p>
          </div>
          <ul className="list-inside list-disc space-y-1 text-xs text-default-500">
            <li>
              <strong className="text-default-600">Exportar:</strong> guarda juegos y rutas en un JSON donde elijas.
            </li>
            <li>
              <strong className="text-default-600">Fusionar:</strong> añade juegos del JSON sin borrar los actuales.
            </li>
            <li>
              <strong className="text-default-600">Reemplazar:</strong> sustituye toda la config (p. ej. un config.json
              recibido).
            </li>
            <li>
              <strong className="text-default-600">Importar de usuario:</strong> trae la configuración pública de otro
              usuario.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="flat" onPress={onExport} isLoading={exporting}>
              Exportar
            </Button>
            <Button size="sm" variant="flat" onPress={onImportMerge} isLoading={importing}>
              Importar (fusionar)
            </Button>
            <Button size="sm" variant="flat" color="warning" onPress={onImportReplace} isLoading={importing}>
              Importar (reemplazar)
            </Button>
            <Button size="sm" variant="flat" color="secondary" onPress={onPullFriendConfig}>
              Importar de usuario
            </Button>
          </div>
        </section>

        <Divider className="my-5" />

        {/* Nube */}
        <section aria-labelledby="config-cloud-backup" className="space-y-3">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-default-500" />
            <p id="config-cloud-backup" className="text-sm font-semibold text-foreground">
              Respaldos en la nube
            </p>
          </div>
          <p className="text-xs text-default-500">
            <strong className="text-default-600">Respaldar:</strong> sube tu config al servidor de tu usuario.{" "}
            <strong className="text-default-600">Restaurar:</strong> aplica la última copia guardada (la app se
            reiniciará).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="flat" color="primary" onPress={onBackupToCloud} isLoading={backingUpConfig}>
              Respaldar en la nube
            </Button>
            <Button size="sm" variant="flat" color="secondary" onPress={onRestoreFromCloud} isLoading={restoringConfig}>
              Restaurar desde la nube
            </Button>
          </div>
        </section>
      </CardBody>
    </Card>
  );
}
