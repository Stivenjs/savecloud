import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface RestoreConfigModalProps {
  isOpen: boolean;
  restoring: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function RestoreConfigModal({ isOpen, restoring, onCancel, onConfirm }: RestoreConfigModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      placement="center">
      <ModalContent>
        <ModalHeader>{t("settings.restoreConfigModal.title")}</ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-500">{t("settings.restoreConfigModal.desc1")}</p>
          <p className="text-sm text-default-500">{t("settings.restoreConfigModal.desc2")}</p>
          <p className="text-sm font-mono text-default-600">SaveCloud/config-backups/config-YYYY-MM-DD_HH-MM-SS.json</p>
          <p className="text-sm text-warning-500">{t("settings.restoreConfigModal.warning")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={restoring}>
            {t("common.cancel")}
          </Button>
          <Button color="secondary" onPress={onConfirm} isLoading={restoring}>
            {t("settings.restoreConfigModal.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
