import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from "@heroui/react";
import { User } from "lucide-react";

interface PullFriendConfigModalProps {
  isOpen: boolean;
  userId: string;
  pulling: boolean;
  onChangeUserId: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function PullFriendConfigModal({
  isOpen,
  userId,
  pulling,
  onChangeUserId,
  onClose,
  onSubmit,
}: PullFriendConfigModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable={!pulling}
      hideCloseButton={pulling}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">Importar configuración de un amigo</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-500">
            Ingresa el <strong>usuario</strong> para descargar su configuración completa desde la nube de SaveCloud.
          </p>
          <p className="text-xs text-warning">
            Nota: Al hacer esto, <strong>su configuración reemplazará la tuya por completo</strong> localmente,
            incluyendo tu propia API Key, usuario y URL del servidor. Esto es útil si estás intentando recuperar tu
            cuenta en un PC nuevo.
          </p>
          <Input
            label="Usuario"
            placeholder="Ej: gabi21"
            value={userId}
            onChange={(e) => onChangeUserId(e.target.value)}
            disabled={pulling}
            startContent={<User size={16} className="text-default-400" />}
            className="mt-2"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={pulling}>
            Cancelar
          </Button>
          <Button color="primary" onPress={onSubmit} isLoading={pulling} isDisabled={!userId.trim()}>
            Importar configuración
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
