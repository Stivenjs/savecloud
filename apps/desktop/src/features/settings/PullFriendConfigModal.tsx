import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from "@heroui/react";
import { User } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PullFriendConfigModalProps {
  isOpen: boolean;
  userId: string;
  pulling: boolean;
  onChangeUserId: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function PullFriendConfigModal({
  isOpen,
  userId,
  pulling,
  onChangeUserId,
  onClose,
  onSubmit,
}: PullFriendConfigModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable={!pulling}
      hideCloseButton={pulling}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{t("settings.pullFriendConfigModal.title")}</ModalHeader>
        <ModalBody>
          <p
            className="text-sm text-default-500"
            dangerouslySetInnerHTML={{ __html: t("settings.pullFriendConfigModal.desc") }}
          />
          <p
            className="text-xs text-warning"
            dangerouslySetInnerHTML={{ __html: t("settings.pullFriendConfigModal.warning") }}
          />
          <Input
            label={t("settings.pullFriendConfigModal.userLabel")}
            placeholder={t("settings.pullFriendConfigModal.userPlaceholder")}
            value={userId}
            onChange={(e) => onChangeUserId(e.target.value)}
            disabled={pulling}
            startContent={<User size={16} className="text-default-400" />}
            className="mt-2"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={pulling}>
            {t("common.cancel")}
          </Button>
          <Button color="primary" onPress={onSubmit} isLoading={pulling} isDisabled={!userId.trim()}>
            {t("settings.pullFriendConfigModal.confirm")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
