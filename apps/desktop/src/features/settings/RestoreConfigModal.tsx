import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";

interface RestoreConfigModalProps {
  isOpen: boolean;
  restoring: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function RestoreConfigModal({ isOpen, restoring, onCancel, onConfirm }: RestoreConfigModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      placement="center">
      <ModalContent>
        <ModalHeader>Restaurar configuración desde la nube</ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-500">
            Se descargará la última copia de tu configuración desde la nube y se aplicará localmente.
          </p>
          <p className="text-sm text-default-500">
            Antes de sobrescribir, se guardará un backup local del archivo actual en la carpeta de configuración:
          </p>
          <p className="text-sm font-mono text-default-600">SaveCloud/config-backups/config-YYYY-MM-DD_HH-MM-SS.json</p>
          <p className="text-sm text-warning-500">Los cambios se aplicarán al instante y la app se recargará.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={restoring}>
            Cancelar
          </Button>
          <Button color="secondary" onPress={onConfirm} isLoading={restoring}>
            Restaurar ahora
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
