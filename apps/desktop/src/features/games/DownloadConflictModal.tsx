import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle, CloudDownload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadConflict } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale.startsWith("en") ? "en" : "es", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface DownloadConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  conflicts: DownloadConflict[];
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DownloadConflictModal({
  isOpen,
  onClose,
  gameId,
  conflicts,
  onConfirm,
  isLoading = false,
}: DownloadConflictModalProps) {
  const { t, i18n } = useTranslation();

  if (conflicts.length === 0) return null;

  const gameName = formatGameDisplayName(gameId);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} placement="center" size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-warning" />
          {t("library.downloadConflict.title")}
        </ModalHeader>
        <ModalBody>
          <p
            className="text-default-600"
            dangerouslySetInnerHTML={{
              __html: t("library.downloadConflict.desc", { count: conflicts.length, gameName }),
            }}
          />
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-default-100 p-3">
            {conflicts.slice(0, 10).map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium text-foreground">{c.filename}</span>
                <span className="text-xs text-default-500">
                  {t("library.downloadConflict.localLabel")}: {formatDate(c.localModified, i18n.language)} →{" "}
                  {t("library.downloadConflict.cloudLabel")}: {formatDate(c.cloudModified, i18n.language)}
                </span>
              </li>
            ))}
            {conflicts.length > 10 && (
              <li className="text-xs text-default-500">
                {t("library.downloadConflict.andMore", { count: conflicts.length - 10 })}
              </li>
            )}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={isLoading} startContent={<CloudDownload size={18} />}>
            {t("library.downloadConflict.overwrite")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
