import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { CloudDownload, CloudUpload, Sparkles } from "lucide-react";

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
  const isSync = type === "sync";
  const title = isSync ? "Subir guardados de todos los juegos" : "Descargar guardados de todos los juegos";
  const message = isSync
    ? `¿Subir guardados de ${count} ${count === 1 ? "juego" : "juegos"} a la nube?`
    : `¿Descargar guardados de ${count} ${count === 1 ? "juego" : "juegos"} desde la nube?`;
  const showPackageRecommendation = isSync && gamesOverSizeThreshold > 0 && count > 0;

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
                  <strong>{gamesOverSizeThreshold}</strong> de {count} {count === 1 ? "juego" : "juegos"} superan 400
                  MB. Para una subida más rápida, usa <strong>Empaquetar y subir</strong> desde el menú ⋯ de cada juego
                  en lugar de subir todos.
                </span>
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancelar
          </Button>
          <Button color="primary" onPress={handleConfirm}>
            {isSync ? "Subir todos" : "Descargar todos"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
