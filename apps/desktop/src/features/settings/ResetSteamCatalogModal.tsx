import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface ResetSteamCatalogModalProps {
  isOpen: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ResetSteamCatalogModal({ isOpen, busy, onCancel, onConfirm }: ResetSteamCatalogModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      placement="center">
      <ModalContent>
        <ModalHeader>{t("settings.resetSteamCatalogModal.title")}</ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-500">{t("settings.resetSteamCatalogModal.desc1")}</p>
          <p className="text-sm text-default-500">{t("settings.resetSteamCatalogModal.desc2")}</p>
          <p className="text-sm text-warning-500">{t("settings.resetSteamCatalogModal.warning")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={busy}>
            {t("settings.resetSteamCatalogModal.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
