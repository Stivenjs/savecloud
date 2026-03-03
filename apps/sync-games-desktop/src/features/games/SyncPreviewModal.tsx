import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@heroui/react";
import { CloudDownload, CloudUpload } from "lucide-react";
import {
  previewDownload,
  previewUpload,
  type PreviewDownload,
  type PreviewUpload,
} from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";
import { useQuery } from "@tanstack/react-query";

interface SyncPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "upload" | "download";
  gameId: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function SyncPreviewModal({
  isOpen,
  onClose,
  type,
  gameId,
  onConfirm,
  isLoading = false,
}: SyncPreviewModalProps) {
  const gameName = formatGameDisplayName(gameId);

  const { data, isLoading: loadingPreview } = useQuery({
    queryKey: ["sync-preview", type, gameId],
    queryFn: () =>
      type === "upload" ? previewUpload(gameId) : previewDownload(gameId),
    enabled: isOpen,
  });

  const uploadData = type === "upload" ? (data as PreviewUpload | undefined) : undefined;
  const downloadData =
    type === "download" ? (data as PreviewDownload | undefined) : undefined;

  const fileCount = uploadData?.fileCount ?? downloadData?.fileCount ?? 0;
  const totalBytes = uploadData?.totalSizeBytes ?? downloadData?.totalSizeBytes ?? 0;
  const conflictCount = downloadData?.conflictCount ?? 0;


  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {type === "upload" ? (
            <CloudUpload size={22} className="text-primary" />
          ) : (
            <CloudDownload size={22} className="text-primary" />
          )}
          {type === "upload" ? "Vista previa: Subir" : "Vista previa: Descargar"}
        </ModalHeader>
        <ModalBody>
          {loadingPreview ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" color="primary" />
            </div>
          ) : fileCount === 0 ? (
            <p className="py-4 text-default-500">
              {type === "upload"
                ? "No hay archivos locales para subir."
                : "No hay archivos en la nube para descargar."}
            </p>
          ) : (
            <>
              <p className="text-default-600">
                <strong>{gameName}</strong>
              </p>
              <div className="rounded-lg bg-default-100 p-4 text-sm">
                <p>
                  {type === "upload"
                    ? `${fileCount} archivo${fileCount !== 1 ? "s" : ""} a subir`
                    : `${fileCount} archivo${fileCount !== 1 ? "s" : ""} a descargar`}
                  {" · "}
                  <strong>{formatBytes(totalBytes)}</strong>
                </p>
                {type === "download" && conflictCount > 0 && (
                  <p className="mt-1 text-warning">
                    {conflictCount} archivo{conflictCount !== 1 ? "s" : ""} con
                    versión local más reciente se sobrescribirán
                  </p>
                )}
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={onConfirm}
            isLoading={isLoading}
            isDisabled={loadingPreview || fileCount === 0}
            startContent={
              type === "upload" ? (
                <CloudUpload size={18} />
              ) : (
                <CloudDownload size={18} />
              )
            }
          >
            {type === "upload" ? "Subir" : "Descargar"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
