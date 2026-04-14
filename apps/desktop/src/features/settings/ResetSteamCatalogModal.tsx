import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";

interface ResetSteamCatalogModalProps {
  isOpen: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ResetSteamCatalogModal({ isOpen, busy, onCancel, onConfirm }: ResetSteamCatalogModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      placement="center">
      <ModalContent>
        <ModalHeader>Volver a descargar todo el catálogo</ModalHeader>
        <ModalBody className="gap-3">
          <p className="text-sm text-default-500">Se reiniciará el progreso de sincronización del catálogo Steam.</p>
          <p className="text-sm text-default-500">
            La próxima sincronización hará una descarga completa por lotes y puede tardar varios minutos.
          </p>
          <p className="text-sm text-warning-500">
            Esto no borra tus ajustes de la app, pero sí reinicia el estado de sincronización del catálogo.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={busy}>
            Cancelar
          </Button>
          <Button color="warning" onPress={onConfirm} isLoading={busy}>
            Restablecer y volver a descargar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
