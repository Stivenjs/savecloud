import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle, CloudDownload } from "lucide-react";
import type { DownloadConflict } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface DownloadConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  conflicts: DownloadConflict[];
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DownloadConflictModal({
  isOpen,
  onClose,
  gameId,
  conflicts,
  onConfirm,
  isLoading = false,
}: DownloadConflictModalProps) {
  if (conflicts.length === 0) return null;

  const gameName = formatGameDisplayName(gameId);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} placement="center" size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-warning" />
          Conflictos de descarga
        </ModalHeader>
        <ModalBody>
          <p className="text-default-600">
            {conflicts.length} archivo{conflicts.length !== 1 ? "s" : ""} de <strong>{gameName}</strong>{" "}
            {conflicts.length === 1 ? "es" : "son"} más reciente{conflicts.length !== 1 ? "s" : ""} que en la nube. Si
            continúas, se sobrescribirán con las versiones de la nube.
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-default-100 p-3">
            {conflicts.slice(0, 10).map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium text-foreground">{c.filename}</span>
                <span className="text-xs text-default-500">
                  Local: {formatDate(c.localModified)} → Nube: {formatDate(c.cloudModified)}
                </span>
              </li>
            ))}
            {conflicts.length > 10 && <li className="text-xs text-default-500">… y {conflicts.length - 10} más</li>}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancelar
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={isLoading} startContent={<CloudDownload size={18} />}>
            Sobrescribir igualmente
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
