import { useState } from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@heroui/react";
import { History } from "lucide-react";
import { listBackups, restoreBackup, type BackupInfo } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { toastSyncResult } from "@utils/toast";
import { useQuery } from "@tanstack/react-query";
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

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups", gameId],
    queryFn: () => listBackups(gameId),
    enabled: isOpen && !!gameId,
  });

  const [restoring, setRestoring] = useState<string | null>(null);

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
        { okCount: 0, errCount: 1, errors: [e instanceof Error ? e.message : String(e)] },
        formatGameDisplayName(game.id)
      );
    } finally {
      setRestoring(null);
    }
  };

  return (
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
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" color="primary" />
            </div>
          ) : !backups?.length ? (
            <p className="py-4 text-default-500">
              No hay backups locales. Los backups se crean al descargar guardados
              desde la nube.
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
                      {b.fileCount} archivo{b.fileCount !== 1 ? "s" : ""}
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
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cerrar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
