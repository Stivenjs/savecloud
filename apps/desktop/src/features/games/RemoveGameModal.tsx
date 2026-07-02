import { useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";

interface RemoveGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onConfirm: (gameId: string) => Promise<void>;
}

export function RemoveGameModal({ isOpen, onClose, game, onConfirm }: RemoveGameModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await onConfirm(game.id);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (!game) return null;

  const pathsInfo = game.paths.length > 1 ? t("library.removeModal.pathsInfo_other", { count: game.paths.length }) : "";

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} placement="center">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Trash2 size={20} className="text-danger" />
          {t("library.removeModal.title")}
        </ModalHeader>
        <ModalBody>
          <p className="text-default-600">{t("library.removeModal.confirm", { gameId: game.id, pathsInfo })}</p>
          <p className="text-sm text-default-400">{t("library.removeModal.warning")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button color="danger" onPress={handleConfirm} isLoading={loading} startContent={<Trash2 size={18} />}>
            {t("common.delete")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
