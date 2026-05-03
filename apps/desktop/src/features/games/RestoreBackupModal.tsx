import { useEffect, useState } from "react";
import {
  Button,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs,
} from "@heroui/react";
import { Cloud, CloudDownload, FolderArchive, FolderOpen, History, Pencil, Trash2 } from "lucide-react";
import {
  listBackups,
  restoreBackup,
  createAndUploadFullBackup,
  listFullBackups,
  downloadAndRestoreFullBackup,
  deleteFullBackup,
  renameFullBackup,
  type BackupInfo,
  type CloudBackupInfo,
} from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";
import { toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useSyncStore } from "@store/SyncStore";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ConfiguredGame } from "@app-types/config";

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onSuccess?: () => void;
  /** Archivos remotos usuales → carpeta local. Solo con nube configurada. */
  onDownloadFromCloud?: () => void | Promise<void>;
  isDownloadingFromCloud?: boolean;
  /** Si es false: solo backups locales en disco (sin llamadas a snapshots en nube). */
  hasCloudIntegration?: boolean;
}

export function RestoreBackupModal({
  isOpen,
  onClose,
  game,
  onSuccess,
  onDownloadFromCloud,
  isDownloadingFromCloud = false,
  hasCloudIntegration = true,
}: RestoreBackupModalProps) {
  const gameId = game?.id ?? "";
  const queryClient = useQueryClient();
  const setSyncOperation = useSyncStore((state) => state.setSyncOperation);

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups", gameId],
    queryFn: () => listBackups(gameId),
    enabled: isOpen && !!gameId,
  });

  const {
    data: cloudBackups,
    isLoading: cloudLoading,
    refetch: refetchCloudBackups,
  } = useQuery({
    queryKey: ["cloud-backups", gameId],
    queryFn: () => listFullBackups(gameId),
    enabled: isOpen && !!gameId && hasCloudIntegration,
  });

  useEffect(() => {
    if (!isOpen) return;
    const unsub = listen("full-backup-done", () => {
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    });
    return () => {
      unsub.then((f) => f());
    };
  }, [isOpen, gameId, queryClient]);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [creatingFullBackup, setCreatingFullBackup] = useState(false);
  const [restoringCloudKey, setRestoringCloudKey] = useState<string | null>(null);
  const [deletingCloudKey, setDeletingCloudKey] = useState<string | null>(null);
  const [renamingBackup, setRenamingBackup] = useState<CloudBackupInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const cloudBusy = isDownloadingFromCloud || !!restoringCloudKey || !!deletingCloudKey;

  const handleRestore = async (backup: BackupInfo) => {
    if (!gameId || !game) return;
    setRestoring(backup.id);
    try {
      const result = await restoreBackup(gameId, backup.id);
      toastSyncResult(result, formatGameDisplayName(game.id));
      onSuccess?.();
      onClose();
    } catch (e) {
      toastSyncResult(
        {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        },
        formatGameDisplayName(game.id)
      );
    } finally {
      setRestoring(null);
    }
  };

  const handleCreateFullBackup = async () => {
    if (!gameId || !game) return;
    setCreatingFullBackup(true);
    setSyncOperation({ type: "upload", mode: "single", gameId, operationId: `sync-upload-${gameId}` });
    try {
      await createAndUploadFullBackup(gameId);
      toastSuccess(
        "Backup completo creado",
        "El backup se ha subido a la nube. Recomendado para juegos con muchos archivos."
      );
      await refetchCloudBackups();
    } catch (e) {
      toastError("Error al crear backup", e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFullBackup(false);
    }
  };

  const handleRestoreCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    setRestoringCloudKey(b.key);
    setSyncOperation({ type: "download", mode: "single", gameId, operationId: `sync-download-${gameId}` });
    try {
      await downloadAndRestoreFullBackup(gameId, b.key);
      toastSuccess("Restauración completada", `Se ha restaurado el backup ${b.filename} en la carpeta del juego.`);
      onSuccess?.();
      onClose();
    } catch (e) {
      toastError("Error al restaurar", e instanceof Error ? e.message : String(e));
    } finally {
      setRestoringCloudKey(null);
    }
  };

  const handleDeleteCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    const confirmed = await ask(`¿Eliminar el backup "${b.filename}" de la nube? Esta acción no se puede deshacer.`, {
      title: "Eliminar backup",
      kind: "warning",
      okLabel: "Aceptar",
      cancelLabel: "Cancelar",
    });
    if (!confirmed) return;
    setDeletingCloudKey(b.key);
    try {
      await deleteFullBackup(gameId, b.key);
      toastSuccess("Backup eliminado", "Se ha eliminado el backup de la nube.");
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    } catch (e) {
      toastError("Error al eliminar", e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingCloudKey(null);
    }
  };

  const openRenameModal = (b: CloudBackupInfo) => {
    setRenamingBackup(b);
    setRenameValue(b.filename);
  };

  const handleRenameSubmit = async () => {
    if (!gameId || !renamingBackup) return;
    const name = renameValue.trim();
    if (!name.endsWith(".tar")) {
      toastError("Nombre inválido", "El nombre debe terminar en .tar");
      return;
    }
    if (name.includes("/") || name.includes("..")) {
      toastError("Nombre inválido", "El nombre no puede contener rutas.");
      return;
    }
    setIsRenaming(true);
    try {
      await renameFullBackup(gameId, renamingBackup.key, name);
      toastSuccess("Backup renombrado", `Ahora se llama "${name}".`);
      setRenamingBackup(null);
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
    } catch (e) {
      toastError("Error al renombrar", e instanceof Error ? e.message : String(e));
    } finally {
      setIsRenaming(false);
    }
  };

  const localBackupList = isLoading ? (
    <div className="flex items-center justify-center py-10">
      <Spinner size="lg" color="primary" />
    </div>
  ) : !backups?.length ? (
    <div className="rounded-xl border border-dashed border-default-300 bg-default-50/40 px-4 py-6 text-center dark:border-default-100/25 dark:bg-default-100/10">
      <FolderArchive className="mx-auto mb-2 size-10 text-default-400" aria-hidden strokeWidth={1.25} />
      <p className="text-sm font-medium text-default-700 dark:text-default-300">Sin copias automáticas aún</p>
      <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-default-500">
        Suele aparecer una copia aquí después de sobrescribir guardados usando la nube — Sirve por si necesitas volver
        atrás sin tocar tu carpeta principal a mano.
      </p>
    </div>
  ) : (
    <ul className="max-h-[min(16rem,50vh)] space-y-2 overflow-y-auto pr-1">
      {backups.map((b: BackupInfo) => (
        <li
          key={b.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-divider bg-content2 px-4 py-3 shadow-sm transition-colors hover:bg-content3/60">
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums text-foreground">{b.createdAt}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-default-400">
              {b.fileCount} archivo{b.fileCount !== 1 ? "s" : ""}
            </p>
          </div>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="shrink-0"
            onPress={() => handleRestore(b)}
            isLoading={restoring === b.id}
            isDisabled={!!restoring || isDownloadingFromCloud}>
            Aplicar
          </Button>
        </li>
      ))}
    </ul>
  );

  const primaryBlock =
    onDownloadFromCloud && hasCloudIntegration ? (
      <section
        className="rounded-lg border border-default-300 bg-default-50 p-4 dark:border-default-100/35 dark:bg-default-100/20"
        aria-labelledby="recover-primary-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-primary">Recomendado</span>
            </div>
            <h3 id="recover-primary-heading" className="text-base font-semibold tracking-tight text-foreground">
              Archivos sincronizados en la nube
            </h3>
            <p className="max-w-[65ch] text-sm leading-relaxed text-default-600 dark:text-default-400">
              Alinea esta carpeta con lo que tienes guardado en tu cuenta — Archivo por archivo — Es la opción habitual
              después de formatear o cambiar de PC.
            </p>
          </div>
          <Button
            color="primary"
            variant="solid"
            className="mt-1 w-full shrink-0 sm:mt-0 sm:w-auto sm:min-w-44"
            startContent={
              isDownloadingFromCloud ? (
                <Spinner color="current" size="sm" />
              ) : (
                <CloudDownload className="size-4 shrink-0" />
              )
            }
            onPress={() => void Promise.resolve(onDownloadFromCloud?.())}
            isDisabled={
              isDownloadingFromCloud || restoring !== null || cloudBusy || creatingFullBackup || !!restoringCloudKey
            }>
            {isDownloadingFromCloud ? "Descargando…" : "Descargar y aplicar"}
          </Button>
        </div>
      </section>
    ) : null;

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex-col items-stretch gap-3 border-b border-default-200/80 pb-4 dark:border-default-100/15">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-default-400">Guardados</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary dark:bg-primary/20">
                <CloudDownload className="size-6" aria-hidden strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-xl font-semibold tracking-tight text-balance text-foreground sm:text-2xl">
                  Traer guardados a este equipo
                </h2>
                <p className="text-sm leading-relaxed text-default-500">
                  Elige una fuente — La recomendación depende de si ya usás la sincronización por archivos o backups
                  empaquetados.
                </p>
              </div>
            </div>
            {game && (
              <div className="flex items-center gap-2 rounded-lg border border-default-200/90 bg-default-50/70 px-3 py-2 dark:border-default-100/18 dark:bg-default-100/20">
                <FolderOpen className="size-4 shrink-0 text-default-500" aria-hidden />
                <span className="min-w-0 truncate text-sm font-semibold">{formatGameDisplayName(game.id)}</span>
                <span className="truncate font-mono text-[11px] text-default-400 tabular-nums">{game.id}</span>
              </div>
            )}
          </ModalHeader>
          <ModalBody className="gap-8 py-6">
            {!hasCloudIntegration && (
              <p className="rounded-xl border border-default-200 bg-default-50/50 px-4 py-3 text-sm text-default-600 dark:border-default-100/20 dark:bg-default-100/10 dark:text-default-400">
                Conectá la nube desde Configuración para descargar archivos y usar snapshots remotos — Mientras tanto
                solo podés usar las copias que ya hay en este equipo.
              </p>
            )}

            {primaryBlock}

            {hasCloudIntegration && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Divider className="flex-1" />
                  <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-default-400">
                    Otras formas de recuperar
                  </span>
                  <Divider className="flex-1" />
                </div>
                <Tabs
                  aria-label="Origen del guardado"
                  fullWidth
                  classNames={{
                    tabList: "w-full gap-1 rounded-lg bg-default-100 p-1 dark:bg-default-100/40",
                    cursor: "bg-content1 shadow-sm dark:bg-content1/90",
                    tab: "h-10 data-[selected=true]:font-semibold",
                  }}>
                  <Tab
                    key="local"
                    title={
                      <span className="flex items-center justify-center gap-2">
                        <FolderArchive size={17} aria-hidden strokeWidth={1.75} />
                        <span>Copias en este equipo</span>
                      </span>
                    }>
                    <div className="pt-4">{localBackupList}</div>
                  </Tab>
                  <Tab
                    key="tar"
                    title={
                      <span className="flex items-center justify-center gap-2">
                        <History size={17} aria-hidden strokeWidth={1.75} />
                        <span className="hidden xs:inline">Snapshots remotos (.tar)</span>
                        <span className="xs:hidden">Snapshots</span>
                      </span>
                    }>
                    <div className="space-y-4 pt-4">
                      <p className="text-sm leading-relaxed text-default-600 dark:text-default-400">
                        Un único archivo con toda la carpeta — Pensado para muchos ficheros — Podés crear uno nuevo,
                        recuperar uno antiguo o gestionarlo.
                      </p>
                      <Button
                        color="primary"
                        variant="flat"
                        startContent={<Cloud className="size-4 shrink-0 text-primary" />}
                        onPress={handleCreateFullBackup}
                        isLoading={creatingFullBackup}
                        isDisabled={creatingFullBackup || isDownloadingFromCloud}>
                        Crear snapshot y subir a la nube
                      </Button>
                      {cloudLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Spinner size="lg" color="primary" />
                        </div>
                      ) : !cloudBackups?.length ? (
                        <div className="rounded-xl border border-dashed border-default-300 px-4 py-6 text-center text-sm text-default-500 dark:border-default-100/25">
                          No hay snapshots en la nube — Creá uno con el botón de arriba.
                        </div>
                      ) : (
                        <ul className="max-h-[min(14rem,45vh)] space-y-2 overflow-y-auto pr-1">
                          {cloudBackups.map((b: CloudBackupInfo) => (
                            <li
                              key={b.key}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-divider bg-content2 px-4 py-3 shadow-sm transition-colors hover:bg-content3/60">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{b.filename}</p>
                                <p className="text-xs tabular-nums text-default-500">
                                  {b.lastModified}
                                  {b.size != null ? ` • ${formatBytes(b.size)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  onPress={() => handleRestoreCloud(b)}
                                  isLoading={restoringCloudKey === b.key}
                                  isDisabled={!!restoringCloudKey || !!deletingCloudKey}>
                                  Restaurar
                                </Button>
                                <Button
                                  size="sm"
                                  isIconOnly
                                  variant="light"
                                  aria-label="Renombrar backup"
                                  onPress={() => openRenameModal(b)}
                                  isDisabled={!!restoringCloudKey || !!deletingCloudKey}>
                                  <Pencil size={16} className="text-default-600" />
                                </Button>
                                <Button
                                  size="sm"
                                  isIconOnly
                                  variant="light"
                                  color="danger"
                                  aria-label="Eliminar backup"
                                  onPress={() => handleDeleteCloud(b)}
                                  isLoading={deletingCloudKey === b.key}
                                  isDisabled={
                                    !!restoringCloudKey || (!!deletingCloudKey && deletingCloudKey !== b.key)
                                  }>
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Tab>
                </Tabs>
              </div>
            )}

            {!hasCloudIntegration && (
              <div className="space-y-3">
                <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-default-400">
                  Copias en este equipo
                </h3>
                {localBackupList}
              </div>
            )}
          </ModalBody>
          <ModalFooter className="border-t border-default-200 dark:border-default-100/15">
            <Button variant="flat" onPress={onClose}>
              Cerrar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={!!renamingBackup} onOpenChange={(open) => !open && setRenamingBackup(null)} size="md">
        <ModalContent>
          <ModalHeader>Renombrar backup</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">
              El nombre debe terminar en <code>.tar</code> (ej. mi-backup.tar).
            </p>
            <Input
              label="Nuevo nombre"
              value={renameValue}
              onValueChange={setRenameValue}
              placeholder="mi-backup.tar"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setRenamingBackup(null)} isDisabled={isRenaming}>
              Cancelar
            </Button>
            <Button color="primary" onPress={handleRenameSubmit} isLoading={isRenaming} isDisabled={isRenaming}>
              Guardar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
