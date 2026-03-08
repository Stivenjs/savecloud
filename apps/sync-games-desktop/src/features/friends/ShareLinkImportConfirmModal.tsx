import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
} from "@heroui/react";
import { CloudDownload, FileText } from "lucide-react";
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
          Importar guardados desde link
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            {files.length > 0 ? (
              <>
                Se copiarán a tu nube los siguientes archivos del juego{" "}
                <strong className="text-foreground">{displayName}</strong>. Si
                no tienes este juego en tu lista, se añadirá una entrada para
                que configures tu ruta local después.
              </>
            ) : (
              <>
                No hay archivos de guardado en este link para{" "}
                <strong className="text-foreground">{displayName}</strong>.
                Puedes importar igualmente para añadir el juego a tu lista y
                configurar tu ruta local después.
              </>
            )}
          </p>
          <div className="rounded-lg border border-default-200 bg-default-50 p-3">
            <p className="mb-2 text-xs font-medium text-default-500">
              {files.length > 0
                ? `${files.length} archivo${files.length !== 1 ? "s" : ""}${totalBytes > 0 ? ` · ${formatSize(totalBytes)} total` : ""}`
                : "Ningún archivo"}
            </p>
            {files.length > 0 ? (
              <ScrollShadow className="max-h-[40vh]">
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li
                      key={`${f.filename}-${i}`}
                      className="flex items-center gap-2 text-sm text-default-700"
                    >
                      <FileText
                        size={14}
                        className="shrink-0 text-default-400"
                      />
                      <span className="truncate font-mono text-xs">
                        {f.filename}
                      </span>
                      {f.size != null && f.size > 0 && (
                        <span className="shrink-0 text-xs text-default-500">
                          {formatSize(f.size)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollShadow>
            ) : (
              <p className="text-xs text-default-500">
                El juego se añadirá a tu configuración sin copiar archivos.
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={handleConfirm}
            isLoading={isLoading}
            startContent={!isLoading ? <CloudDownload size={18} /> : undefined}
          >
            Importar a mi nube
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
