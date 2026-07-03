import { useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatGameDisplayName } from "@utils/gameImage";
import type { ConfiguredGame } from "@app-types/config";

interface FullBackupConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  /** Debe ser async; el modal muestra spinner hasta que termine y luego se cierra. */
  onConfirm: () => void | Promise<void>;
}

export function FullBackupConfirmModal({ isOpen, onClose, game, onConfirm }: FullBackupConfirmModalProps) {
  const { t } = useTranslation();
  const gameName = game ? formatGameDisplayName(game.id) : "";
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await Promise.resolve(onConfirm());
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Archive size={22} className="text-primary" />
          {t("library.fullBackup.title")}
        </ModalHeader>
        <ModalBody className="space-y-4">
          {game && (
            <p
              className="text-default-600"
              dangerouslySetInnerHTML={{
                __html: t("library.fullBackup.intro", { gameName }),
              }}
            />
          )}
          <div className="rounded-lg bg-default-100 p-4 text-sm text-default-600">
            <p className="font-medium text-foreground">{t("library.fullBackup.purposeTitle")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{t("library.fullBackup.purpose1")}</li>
              <li>{t("library.fullBackup.purpose2")}</li>
              <li>{t("library.fullBackup.purpose3")}</li>
              <li>{t("library.fullBackup.purpose4")}</li>
            </ul>
          </div>
          <p className="text-default-500">{t("library.fullBackup.confirmQuestion")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={handleConfirm}
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
            startContent={!isSubmitting ? <Archive size={18} /> : undefined}>
            {t("library.fullBackup.confirmButton")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
