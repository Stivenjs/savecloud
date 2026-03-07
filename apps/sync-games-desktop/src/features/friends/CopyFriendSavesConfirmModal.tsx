import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
  Spinner,
} from "@heroui/react";
import { CloudDownload, FileText } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";

export interface CopyFriendSaveItem {
  filename: string;
  targetFilename: string;
}

interface CopyFriendSavesConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  gameDisplayName?: string;
  /** Archivos que se copiarán (filename → nombre final en tu nube). */
  items: CopyFriendSaveItem[];
  /** Cuántos son nuevos (sin conflicto). */
  newCount: number;
  /** Cuántos se renombrarán por conflicto. */
  conflictCount: number;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function CopyFriendSavesConfirmModal({
  isOpen,
  onClose,
  gameId,
  gameDisplayName,
  items,
  newCount,
  conflictCount,
  onConfirm,
  isLoading = false,
}: CopyFriendSavesConfirmModalProps) {
  const displayName = gameDisplayName ?? formatGameDisplayName(gameId);
  const hasConflicts = conflictCount > 0;

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <CloudDownload size={22} className="text-primary" />
          Copiar guardados del amigo a tu nube
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            Se copiarán los guardados del juego{" "}
            <strong className="text-foreground">{displayName}</strong> desde la
            nube de tu amigo a tu nube. Los archivos quedarán asociados a este
            juego en tu cuenta.
          </p>
          {hasConflicts && (
            <p className="text-sm text-warning-600">
              {conflictCount} archivo{conflictCount !== 1 ? "s" : ""} ya existe
              {conflictCount !== 1 ? "n" : ""} en tu nube y se copiará
              {conflictCount !== 1 ? "n" : ""} con un nombre distinto (ej.{" "}
              <span className="font-mono text-xs">archivo (amigo 1).sav</span>)
              para no sobrescribir.
            </p>
          )}
          <div className="rounded-lg border border-default-200 bg-default-50 p-3">
            <p className="mb-2 text-xs font-medium text-default-500">
              {items.length} archivo{items.length !== 1 ? "s" : ""} en total
              {newCount > 0 && conflictCount > 0
                ? ` · ${newCount} nuevo${newCount !== 1 ? "s" : ""}, ${conflictCount} con nuevo nombre`
                : conflictCount > 0
                  ? ` · ${conflictCount} con nuevo nombre`
                  : ""}
            </p>
            <ScrollShadow className="max-h-[40vh]">
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <li
                    key={`${item.filename}-${i}`}
                    className="flex flex-col gap-0.5 text-sm text-default-700"
                  >
                    <span className="flex items-center gap-2">
                      <FileText
                        size={14}
                        className="shrink-0 text-default-400"
                      />
                      <span className="truncate font-mono text-xs">
                        {item.filename}
                      </span>
                    </span>
                    {item.targetFilename !== item.filename && (
                      <span className="ml-6 text-xs text-default-500">
                        → <span className="font-mono">{item.targetFilename}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollShadow>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={handleConfirm}
            isLoading={isLoading}
            startContent={
              isLoading ? (
                <Spinner size="sm" color="current" />
              ) : (
                <CloudDownload size={18} />
              )
            }
          >
            Copiar a mi nube
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
