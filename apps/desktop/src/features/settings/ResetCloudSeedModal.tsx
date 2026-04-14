import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { AlertTriangle } from "lucide-react";

interface ResetCloudSeedModalProps {
  isOpen: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ResetCloudSeedModal({ isOpen, busy, onCancel, onConfirm }: ResetCloudSeedModalProps) {
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
          Reiniciar descarga en la nube
        </ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-600">
            Esto reiniciará el estado del worker que trae los juegos de Steam desde la nube.
          </p>
          <p className="text-sm text-warning-600">
            <strong>Advertencia:</strong> Se borrará el progreso actual y comenzará la descarga desde cero. Solo usa
            esto si tienes problemas con la sincronización o si quieres forzar una descarga completa.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={busy}>
            Cancelar
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={busy}>
            Reiniciar descarga
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
