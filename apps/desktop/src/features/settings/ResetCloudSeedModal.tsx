import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ResetCloudSeedModalProps {
  isOpen: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ResetCloudSeedModal({ isOpen, busy, onCancel, onConfirm }: ResetCloudSeedModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      placement="center">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-warning-600">
          <AlertTriangle size={20} />
          {t("settings.resetCloudSeedModal.title")}
        </ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-600">{t("settings.resetCloudSeedModal.desc")}</p>
          <p className="text-sm text-warning-600">
            <strong>{t("steamCatalog.installModal.note")}:</strong> {t("settings.resetCloudSeedModal.warning")}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={busy}>
            {t("settings.resetCloudSeedModal.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
