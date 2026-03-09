import { useEffect, useState } from "react";
import {
  Button,
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
import { Cloud, History, Pencil, Trash2 } from "lucide-react";
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
import { ask } from "@tauri-apps/plugin-dialog";
import type { ConfiguredGame } from "@app-types/config";

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onSuccess?: () => void;
}

export function RestoreBackupModal({
  isOpen,
  onClose,
  game,
  onSuccess,
}: RestoreBackupModalProps) {
  const gameId = game?.id ?? "";
  const queryClient = useQueryClient();

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
    enabled: isOpen && !!gameId,
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
  const [restoringCloudKey, setRestoringCloudKey] = useState<string | null>(
    null
  );
  const [deletingCloudKey, setDeletingCloudKey] = useState<string | null>(null);
  const [renamingBackup, setRenamingBackup] = useState<CloudBackupInfo | null>(
    null
  );
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

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
    try {
      await createAndUploadFullBackup(gameId);
      toastSuccess(
        "Backup completo creado",
        "El backup se ha subido a la nube. Recomendado para juegos con muchos archivos."
      );
      await refetchCloudBackups();
    } catch (e) {
      toastError(
        "Error al crear backup",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setCreatingFullBackup(false);
    }
  };

  const handleRestoreCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    setRestoringCloudKey(b.key);
    try {
      await downloadAndRestoreFullBackup(gameId, b.key);
      toastSuccess(
        "Restauración completada",
        `Se ha restaurado el backup ${b.filename} en la carpeta del juego.`
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      toastError(
        "Error al restaurar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setRestoringCloudKey(null);
    }
  };

  const handleDeleteCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    const confirmed = await ask(
      `¿Eliminar el backup "${b.filename}" de la nube? Esta acción no se puede deshacer.`,
      {
        title: "Eliminar backup",
        kind: "warning",
        okLabel: "Aceptar",
        cancelLabel: "Cancelar",
      }
    );
    if (!confirmed) return;
    setDeletingCloudKey(b.key);
    try {
      await deleteFullBackup(gameId, b.key);
      toastSuccess("Backup eliminado", "Se ha eliminado el backup de la nube.");
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    } catch (e) {
      toastError(
        "Error al eliminar",
        e instanceof Error ? e.message : String(e)
      );
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
      toastError(
        "Error al renombrar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <History size={22} className="text-default-500" />
            Restaurar desde backup
          </ModalHeader>
          <ModalBody>
            {game && (
              <p className="text-default-600">
                <strong>{formatGameDisplayName(game.id)}</strong>
              </p>
            )}
            <Tabs aria-label="Tipo de backup" fullWidth>
              <Tab
                key="local"
                title={
                  <span className="flex items-center gap-2">
                    <History size={16} />
                    Locales
                  </span>
                }
              >
                <div className="py-2">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner size="lg" color="primary" />
                    </div>
                  ) : !backups?.length ? (
                    <p className="py-4 text-default-500">
                      No hay backups locales. Los backups se crean al descargar
                      guardados desde la nube.
                    </p>
                  ) : (
                    <ul className="max-h-60 space-y-2 overflow-y-auto">
                      {backups.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-50/50 px-4 py-3 dark:bg-default-100/20"
                        >
                          <div>
                            <p className="font-medium">{b.createdAt}</p>
                            <p className="text-xs text-default-500">
                              {b.fileCount} archivo
                              {b.fileCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            color="primary"
                            variant="flat"
                            onPress={() => handleRestore(b)}
                            isLoading={restoring === b.id}
                            isDisabled={!!restoring}
                          >
                            Restaurar
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Tab>
              <Tab
                key="cloud"
                title={
                  <span className="flex items-center gap-2">
                    <Cloud size={16} />
                    En la nube
                  </span>
                }
              >
                <div className="space-y-4 py-2">
                  <p className="text-sm text-default-500">
                    Crea un único archivo .tar con toda la carpeta del juego y
                    súbelo a la nube. Recomendado para juegos con muchos
                    archivos.
                  </p>
                  <Button
                    color="primary"
                    variant="flat"
                    startContent={<Cloud size={18} />}
                    onPress={handleCreateFullBackup}
                    isLoading={creatingFullBackup}
                    isDisabled={creatingFullBackup}
                  >
                    Crear backup completo y subir a la nube
                  </Button>
                  {cloudLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Spinner size="lg" color="primary" />
                    </div>
                  ) : !cloudBackups?.length ? (
                    <p className="py-2 text-default-500">
                      No hay backups completos en la nube. Crea uno con el botón
                      de arriba.
                    </p>
                  ) : (
                    <ul className="max-h-52 space-y-2 overflow-y-auto">
                      {cloudBackups.map((b) => (
                        <li
                          key={b.key}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default-200 bg-default-50/50 px-4 py-3 dark:bg-default-100/20"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{b.filename}</p>
                            <p className="text-xs text-default-500">
                              {b.lastModified}
                              {b.size != null && ` • ${formatBytes(b.size)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              color="primary"
                              variant="flat"
                              onPress={() => handleRestoreCloud(b)}
                              isLoading={restoringCloudKey === b.key}
                              isDisabled={
                                !!restoringCloudKey || !!deletingCloudKey
                              }
                            >
                              Restaurar
                            </Button>
                            <Button
                              size="sm"
                              isIconOnly
                              variant="light"
                              aria-label="Renombrar backup"
                              onPress={() => openRenameModal(b)}
                              isDisabled={
                                !!restoringCloudKey || !!deletingCloudKey
                              }
                            >
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
                                !!restoringCloudKey ||
                                (!!deletingCloudKey &&
                                  deletingCloudKey !== b.key)
                              }
                            >
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
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>
              Cerrar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Modal para renombrar backup empaquetado */}
      <Modal
        isOpen={!!renamingBackup}
        onOpenChange={(open) => !open && setRenamingBackup(null)}
        size="md"
      >
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
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setRenamingBackup(null)}
              isDisabled={isRenaming}
            >
              Cancelar
            </Button>
            <Button
              color="primary"
              onPress={handleRenameSubmit}
              isLoading={isRenaming}
              isDisabled={isRenaming}
            >
              Guardar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
