import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow } from "@heroui/react";
import { CloudDownload, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatSize } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";

export interface ShareLinkFilePreview {
  filename: string;
  size?: number;
}

interface ShareLinkImportConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  gameDisplayName?: string;
  files: ShareLinkFilePreview[];
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function ShareLinkImportConfirmModal({
  isOpen,
  onClose,
  gameId,
  gameDisplayName,
  files,
  onConfirm,
  isLoading = false,
}: ShareLinkImportConfirmModalProps) {
  const { t } = useTranslation();
  const totalBytes = files.reduce((s, f) => s + (f.size ?? 0), 0);
  const displayName = gameDisplayName ?? formatGameDisplayName(gameId);

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <CloudDownload size={22} className="text-primary" />
          {t("friends.shareLinkImport.title")}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            {files.length > 0
              ? t("friends.shareLinkImport.descWithFiles", { name: displayName })
              : t("friends.shareLinkImport.descNoFiles", { name: displayName })}
          </p>
          <div className="rounded-lg border border-default-200 bg-default-50 p-3">
            <p className="mb-2 text-xs font-medium text-default-500">
              {files.length > 0
                ? t("friends.shareLinkImport.filesStats", { count: files.length, size: formatSize(totalBytes) })
                : t("friends.shareLinkImport.noFiles")}
            </p>
            {files.length > 0 ? (
              <ScrollShadow className="max-h-[40vh]">
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.filename}-${i}`} className="flex items-center gap-2 text-sm text-default-700">
                      <FileText size={14} className="shrink-0 text-default-400" />
                      <span className="truncate font-mono text-xs">{f.filename}</span>
                      {f.size != null && f.size > 0 && (
                        <span className="shrink-0 text-xs text-default-500">{formatSize(f.size)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollShadow>
            ) : (
              <p className="text-xs text-default-500">{t("friends.shareLinkImport.gameAddedOnly")}</p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={handleConfirm}
            isLoading={isLoading}
            startContent={!isLoading ? <CloudDownload size={18} /> : undefined}>
            {t("friends.shareLinkImport.importButton")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
