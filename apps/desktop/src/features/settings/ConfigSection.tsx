import { Button, Card, CardBody, Divider, Progress, Skeleton } from "@heroui/react";
import { SteamSeedFreshnessBanner } from "@features/steam-catalog/components/SteamSeedFreshnessBanner";
import { FileJson, Cloud, HardDrive, FolderOpen, Link2, Library, Zap } from "lucide-react";
import type { SteamCatalogSyncProgressPayload, SteamSeedImportProgressPayload } from "@services/tauri";

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
  steamCatalogSyncProgress?: SteamCatalogSyncProgressPayload | null;
  steamSeedImportProgress?: SteamSeedImportProgressPayload | null;
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
  onImportCloudSeedFromCloud?: () => void | Promise<void>;
  /** Controla la visibilidad del modal de reinicio de cloud seed */
  isResetCloudSeedModalOpen?: boolean;
  /** Abre el modal de reinicio de cloud seed */
  onOpenResetCloudSeedModal?: () => void;
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
  steamCatalogSyncProgress = null,
  steamSeedImportProgress = null,
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
  onImportCloudSeedFromCloud,
  onOpenResetCloudSeedModal,
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
            Con la clave de Steam que añades en «Configurar conexión», la app descarga los nombres del catálogo oficial
            para poder buscar juegos en SaveCloud. La primera vez puede tardar; después solo se traen novedades.
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
              Actualizar listado ahora
            </Button>
            <Button
              size="sm"
              variant="light"
              color="warning"
              isDisabled={steamCatalogBusy}
              onPress={() => onResetSteamCatalogSync?.()}>
              Borrar progreso y volver a descargar todo
            </Button>
          </div>
          {steamCatalogBusy ? (
            <div className="mt-3 space-y-1.5 rounded-medium border border-default-200/80 bg-default-50/40 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
              <Progress
                size="sm"
                isIndeterminate
                aria-label="Progreso de actualización del catálogo Steam"
                classNames={{ track: "h-1.5" }}
              />
              <p className="text-xs text-default-500">
                {steamCatalogSyncProgress
                  ? steamCatalogSyncProgress.done
                    ? "Listo."
                    : `Paso ${steamCatalogSyncProgress.batch} · ${steamCatalogSyncProgress.appsUpserted.toLocaleString()} juegos guardados`
                  : "Conectando con Steam…"}
              </p>
            </div>
          ) : null}
        </section>

        <Divider className="my-5" />

        {/* Datos enriquecidos desde la nube (host / compartida) */}
        <section aria-labelledby="config-steam-seed" className="space-y-3">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-default-500" />
            <p id="config-steam-seed" className="text-xs font-semibold uppercase tracking-wider text-default-500">
              Información de juegos desde la nube
            </p>
          </div>
          <p className="text-sm text-default-600">
            Si usas la nube compartida, el anfitrión puede enviar su lista de juegos; el servidor la enriquece con datos
            de la tienda. Aquí puedes enviar tu propia lista o descargar todo lo disponible a este equipo (una sola vez
            hasta completar).
          </p>
          <SteamSeedFreshnessBanner />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              color="primary"
              isDisabled={steamSeedBusy}
              isLoading={steamSeedBusy}
              onPress={() => onExportSteamSeedManifest?.()}>
              Enviar mi lista de juegos
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              isDisabled={steamSeedBusy}
              onPress={() => onImportCloudSeedFromCloud?.()}>
              Descargar información detallada
            </Button>
            <Button
              size="sm"
              variant="light"
              color="warning"
              isDisabled={steamSeedBusy}
              onPress={() => onOpenResetCloudSeedModal?.()}>
              Reiniciar descarga en la nube
            </Button>
          </div>
          {steamSeedBusy ? (
            <div className="mt-3 space-y-1.5 rounded-medium border border-default-200/80 bg-default-50/40 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
              <Progress
                size="sm"
                isIndeterminate
                aria-label="Progreso de descarga de información desde la nube"
                classNames={{ track: "h-1.5" }}
              />
              <p className="text-xs text-default-500">
                {steamSeedImportProgress
                  ? steamSeedImportProgress.done
                    ? "Finalizando…"
                    : `Pasada ${steamSeedImportProgress.iteration} · ${steamSeedImportProgress.totalBatches} lotes · ${steamSeedImportProgress.totalRowsUpdated.toLocaleString()} juegos actualizados`
                  : "Preparando descarga…"}
              </p>
            </div>
          ) : null}
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
