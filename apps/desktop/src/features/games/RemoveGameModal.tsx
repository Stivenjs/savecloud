import { useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Trash2 } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";

interface RemoveGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onConfirm: (gameId: string) => Promise<void>;
}

export function RemoveGameModal({ isOpen, onClose, game, onConfirm }: RemoveGameModalProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await onConfirm(game.id);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (!game) return null;

  const pathsInfo = game.paths.length > 1 ? ` y sus ${game.paths.length} rutas` : "";

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} placement="center">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Trash2 size={20} className="text-danger" />
          Eliminar juego
        </ModalHeader>
        <ModalBody>
          <p className="text-default-600">
            ¿Eliminar &quot;{game.id}&quot;{pathsInfo}?
          </p>
          <p className="text-sm text-default-400">
            Se quitará de la app y sus guardados se borrarán de la nube. Esta acción no se puede deshacer.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancelar
          </Button>
          <Button color="danger" onPress={handleConfirm} isLoading={loading} startContent={<Trash2 size={18} />}>
            Eliminar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
