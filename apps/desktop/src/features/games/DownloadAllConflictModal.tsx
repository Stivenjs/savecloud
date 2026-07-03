import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle, CloudDownload } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  if (gamesWithConflicts.length === 0) return null;

  const totalConflicts = gamesWithConflicts.reduce((sum, g) => sum + g.conflictCount, 0);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} placement="center" size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-warning" />
          {t("library.downloadAllConflict.title")}
        </ModalHeader>
        <ModalBody>
          <p className="text-default-600">
            {t("library.downloadAllConflict.desc", {
              count: gamesWithConflicts.length,
              totalConflicts,
            })}
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-default-100 p-3">
            {gamesWithConflicts.map((g) => (
              <li key={g.gameId} className="text-sm">
                <span className="font-medium text-foreground">{formatGameDisplayName(g.gameId)}</span>{" "}
                <span className="text-default-500">
                  ({t("library.downloadAllConflict.fileCount", { count: g.conflictCount })})
                </span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={isLoading} startContent={<CloudDownload size={18} />}>
            {t("library.downloadAllConflict.overwriteAll")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
