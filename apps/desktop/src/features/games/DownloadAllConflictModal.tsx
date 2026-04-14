import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle, CloudDownload } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";

export interface GameWithConflicts {
  gameId: string;
  conflictCount: number;
}

interface DownloadAllConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  gamesWithConflicts: GameWithConflicts[];
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DownloadAllConflictModal({
  isOpen,
  onClose,
  gamesWithConflicts,
  onConfirm,
  isLoading = false,
}: DownloadAllConflictModalProps) {
  if (gamesWithConflicts.length === 0) return null;

  const totalConflicts = gamesWithConflicts.reduce((sum, g) => sum + g.conflictCount, 0);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} placement="center" size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-warning" />
          Conflictos en varios juegos
        </ModalHeader>
        <ModalBody>
          <p className="text-default-600">
            Los siguientes {gamesWithConflicts.length} juego
            {gamesWithConflicts.length !== 1 ? "s tienen" : " tiene"} {totalConflicts} archivo
            {totalConflicts !== 1 ? "s" : ""} locales más reciente{totalConflicts !== 1 ? "s" : ""} que en la nube. Si
            continúas, se sobrescribirán con las versiones de la nube.
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-default-100 p-3">
            {gamesWithConflicts.map((g) => (
              <li key={g.gameId} className="text-sm">
                <span className="font-medium text-foreground">{formatGameDisplayName(g.gameId)}</span>{" "}
                <span className="text-default-500">
                  ({g.conflictCount} archivo{g.conflictCount !== 1 ? "s" : ""})
                </span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancelar
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={isLoading} startContent={<CloudDownload size={18} />}>
            Sobrescribir todos
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
