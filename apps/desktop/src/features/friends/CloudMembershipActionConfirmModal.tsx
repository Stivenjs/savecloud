import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { LogOut, TriangleAlert, Trash2 } from "lucide-react";

export type CloudMembershipActionType = "remove-member" | "leave-membership";

interface CloudMembershipActionConfirmModalProps {
  isOpen: boolean;
  actionType: CloudMembershipActionType;
  userId: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

const ACTION_COPY: Record<
  CloudMembershipActionType,
  { title: string; body: string; confirmLabel: string; color: "danger" | "warning"; icon: React.ReactNode }
> = {
  "remove-member": {
    title: "Eliminar miembro de tu nube",
    body: "Este usuario perderá acceso a tu nube compartida y dejará de ver sus guardados sincronizados ahí.",
    confirmLabel: "Eliminar miembro",
    color: "danger",
    icon: <Trash2 className="h-5 w-5" />,
  },
  "leave-membership": {
    title: "Salir de la nube",
    body: "Vas a salir de esta nube compartida y dejarás de tener acceso a los guardados asociados a ella.",
    confirmLabel: "Salir de la nube",
    color: "warning",
    icon: <LogOut className="h-5 w-5" />,
  },
};

export function CloudMembershipActionConfirmModal({
  isOpen,
  actionType,
  userId,
  onClose,
  onConfirm,
  isLoading = false,
}: CloudMembershipActionConfirmModalProps) {
  const copy = ACTION_COPY[actionType];

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} placement="center" size="md" backdrop="opaque">
      <ModalContent>
        <>
          <ModalHeader className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-default-100 text-default-700">
              {copy.icon}
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">{copy.title}</p>
              <p className="text-[11px] text-default-500">Acción irreversible</p>
            </div>
          </ModalHeader>

          <ModalBody className="gap-3">
            <div className="rounded-xl border border-default-200 bg-default-50/70 px-3 py-3 text-sm text-default-600">
              <div className="mb-2 flex items-center gap-2 text-warning-600">
                <TriangleAlert className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Confirmación requerida</span>
              </div>
              <p>{copy.body}</p>
              <p className="mt-3 text-xs text-default-500">
                Usuario afectado: <span className="font-mono text-default-700">{userId}</span>
              </p>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
              Cancelar
            </Button>
            <Button color={copy.color} onPress={handleConfirm} isLoading={isLoading}>
              {copy.confirmLabel}
            </Button>
          </ModalFooter>
        </>
      </ModalContent>
    </Modal>
  );
}
