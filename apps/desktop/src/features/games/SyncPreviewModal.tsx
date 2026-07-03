import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow, Spinner } from "@heroui/react";
import { Archive, CloudDownload, CloudUpload, FileText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { previewDownload, previewUpload, type PreviewDownload, type PreviewUpload } from "@services/tauri";
import type { PreviewFile } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";
import { getPackageRecommendation, isGameTooLargeForSync } from "@utils/packageRecommendation";
import { useQuery } from "@tanstack/react-query";

interface SyncPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "upload" | "download";
  gameId: string;
  onConfirm: () => void;
  /** Si se pasa y type es "upload", muestra opción para empaquetar y subir (backup completo). */
  onFullBackupInstead?: () => void;
  isLoading?: boolean;
}

export function SyncPreviewModal({
  isOpen,
  onClose,
  type,
  gameId,
  onConfirm,
  onFullBackupInstead,
  isLoading = false,
}: SyncPreviewModalProps) {
  const { t } = useTranslation();
  const gameName = formatGameDisplayName(gameId);

  const { data, isLoading: loadingPreview } = useQuery({
    queryKey: ["sync-preview", type, gameId],
    queryFn: () => (type === "upload" ? previewUpload(gameId) : previewDownload(gameId)),
    enabled: isOpen,
  });

  const uploadData = type === "upload" ? (data as PreviewUpload | undefined) : undefined;
  const downloadData = type === "download" ? (data as PreviewDownload | undefined) : undefined;

  const fileCount = uploadData?.fileCount ?? downloadData?.fileCount ?? 0;
  const totalBytes = uploadData?.totalSizeBytes ?? downloadData?.totalSizeBytes ?? 0;
  const conflictCount = downloadData?.conflictCount ?? 0;
  const files: PreviewFile[] = type === "upload" ? (uploadData?.files ?? []) : (downloadData?.files ?? []);

  const packageRecommendation =
    type === "upload" && fileCount > 0
      ? getPackageRecommendation(fileCount, totalBytes)
      : { recommend: false, reason: "" };

  const isUploadBlocked = type === "upload" && fileCount > 0 && isGameTooLargeForSync(fileCount, totalBytes);

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {type === "upload" ? (
            <CloudUpload size={22} className="text-primary" />
          ) : (
            <CloudDownload size={22} className="text-primary" />
          )}
          {type === "upload" ? t("library.syncPreview.uploadTitle") : t("library.syncPreview.downloadTitle")}
        </ModalHeader>
        <ModalBody>
          {loadingPreview ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" color="primary" />
            </div>
          ) : fileCount === 0 ? (
            <p className="py-4 text-default-500">
              {type === "upload" ? t("library.syncPreview.noLocalFiles") : t("library.syncPreview.noCloudFiles")}
            </p>
          ) : (
            <>
              <p className="text-default-600">
                <strong>{gameName}</strong>
              </p>
              {type === "upload" && onFullBackupInstead && (
                <>
                  {isUploadBlocked ? (
                    <div className="rounded-lg border p-3 text-sm text-foreground border-warning bg-warning/10 mb-3">
                      <p className="flex items-start gap-2 font-medium">
                        <Sparkles size={18} className="mt-0.5 shrink-0 text-warning" />
                        <span>{t("library.syncPreview.tooLargeWarning")}</span>
                      </p>
                      <Button
                        size="sm"
                        className="mt-3"
                        color="warning"
                        variant="flat"
                        startContent={<Archive size={16} />}
                        onPress={() => {
                          onFullBackupInstead();
                          onClose();
                        }}
                        isDisabled={isLoading}>
                        {t("library.syncPreview.packageUploadRequired")}
                      </Button>
                    </div>
                  ) : (
                    packageRecommendation.recommend && (
                      <div className="rounded-lg border p-3 text-sm text-foreground border-primary/40 bg-primary/10 mb-3">
                        <p className="flex items-start gap-2 font-medium">
                          <Sparkles size={18} className="mt-0.5 shrink-0 text-primary" />
                          <span>{packageRecommendation.reason}</span>
                        </p>
                        <Button
                          size="sm"
                          className="mt-3"
                          color="primary"
                          variant="flat"
                          startContent={<Archive size={16} />}
                          onPress={() => {
                            onFullBackupInstead();
                            onClose();
                          }}
                          isDisabled={isLoading}>
                          {t("library.syncPreview.packageUploadRecommended")}
                        </Button>
                      </div>
                    )
                  )}
                </>
              )}
              <div className="rounded-lg bg-default-100 p-4 text-sm">
                <p>
                  {type === "upload"
                    ? t("library.syncPreview.filesToUpload", { count: fileCount })
                    : t("library.syncPreview.filesToDownload", { count: fileCount })}
                  {" · "}
                  <strong>{formatBytes(totalBytes)}</strong>
                </p>
                {type === "upload" && onFullBackupInstead && !packageRecommendation.recommend && !isUploadBlocked && (
                  <p className="mt-3">
                    <Button
                      size="sm"
                      variant="flat"
                      color="secondary"
                      startContent={<Archive size={16} />}
                      onPress={() => {
                        onFullBackupInstead();
                        onClose();
                      }}
                      isDisabled={isLoading}>
                      {t("library.syncPreview.packageUploadFull")}
                    </Button>
                  </p>
                )}
                {type === "download" && conflictCount > 0 && (
                  <p className="mt-1 text-warning">
                    {t("library.syncPreview.conflictsOverwrite", { count: conflictCount })}
                  </p>
                )}
              </div>
              {files.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-default-500">
                    {t("library.syncPreview.filesAndFolders")}
                  </p>
                  <ScrollShadow className="max-h-60 w-full rounded-medium border border-default-200">
                    <ul className="list-inside space-y-1 px-3 py-2 text-sm">
                      {files.map((file) => (
                        <li
                          key={file.filename}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 font-mono text-xs hover:bg-default-100">
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText size={14} className="shrink-0 text-default-400" />
                            <span className="truncate" title={file.filename}>
                              {file.filename}
                            </span>
                            {type === "download" && file.localNewer === true && (
                              <span className="shrink-0 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
                                {t("library.syncPreview.localNewer")}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-default-500">{formatBytes(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </ScrollShadow>
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={onConfirm}
            isLoading={isLoading}
            isDisabled={loadingPreview || fileCount === 0 || (type === "upload" && isUploadBlocked)}
            startContent={type === "upload" ? <CloudUpload size={18} /> : <CloudDownload size={18} />}>
            {type === "upload" ? t("library.syncPreview.upload") : t("library.syncPreview.download")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
