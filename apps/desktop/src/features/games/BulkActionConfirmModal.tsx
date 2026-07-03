import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { CloudDownload, CloudUpload, Sparkles } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

interface BulkActionConfirmModalProps {
  isOpen: boolean;
  type: "sync" | "download";
  count: number;
  /** Cuando type es "sync", juegos que superan el umbral de tamaño (recomendación de empaquetar). */
  gamesOverSizeThreshold?: number;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function BulkActionConfirmModal({
  isOpen,
  type,
  count,
  gamesOverSizeThreshold = 0,
  onConfirm,
  onClose,
}: BulkActionConfirmModalProps) {
  const { t } = useTranslation();
  const isSync = type === "sync";
  const title = isSync ? t("library.bulkAction.uploadTitle") : t("library.bulkAction.downloadTitle");
  const message = isSync
    ? t("library.bulkAction.uploadMessage", { count })
    : t("library.bulkAction.downloadMessage", { count });
  const showPackageRecommendation = isSync && gamesOverSizeThreshold > 0 && count > 0;
  const gamesLabel = t("library.bulkAction.game", { count });

  const handleConfirm = async () => {
    await onConfirm();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} placement="center">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {isSync ? (
            <CloudUpload size={22} className="text-primary" />
          ) : (
            <CloudDownload size={22} className="text-primary" />
          )}
          {title}
        </ModalHeader>
        <ModalBody className="space-y-3">
          <p className="text-default-600">{message}</p>
          {showPackageRecommendation && (
            <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
              <p className="flex items-start gap-2">
                <Sparkles size={18} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  <Trans
                    i18nKey="library.bulkAction.packageRecommendation"
                    values={{ overThreshold: gamesOverSizeThreshold, total: count, gamesLabel }}
                    components={{ strong: <strong /> }}
                  />
                </span>
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button color="primary" onPress={handleConfirm}>
            {isSync ? t("library.bulkAction.uploadAll") : t("library.bulkAction.downloadAll")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
