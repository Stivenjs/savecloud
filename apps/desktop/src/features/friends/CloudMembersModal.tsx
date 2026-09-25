import { Modal, ModalContent } from "@heroui/react";
import { CloudMembersPanel } from "@features/friends/CloudMembersPanel";

interface CloudMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
  modalRef: React.RefObject<HTMLElement>;
  onDetachToWindow?: () => void;
}

export function CloudMembersModal({
  isOpen,
  onClose,
  onViewProfile,
  onRemoveMember,
  onLeaveMembership,
  modalRef,
  onDetachToWindow,
}: CloudMembersModalProps) {
  return (
    <Modal
      ref={modalRef}
      isOpen={isOpen}
      onOpenChange={(isOpenChange) => {
        if (isOpenChange) return;
        onClose();
      }}
      isDismissable={false}
      isKeyboardDismissDisabled
      hideCloseButton
      backdrop="transparent"
      placement="center"
      classNames={{
        wrapper: "z-[9999]",
        base: "flex h-[min(82dvh,760px)] w-[min(86vw,340px)] flex-col overflow-hidden rounded-[18px] border border-default-200/80 bg-background/65 shadow-2xl backdrop-blur-md",
      }}>
      <ModalContent>
        {() => (
          <CloudMembersPanel
            isOpen={isOpen}
            onClose={onClose}
            onViewProfile={onViewProfile}
            onRemoveMember={onRemoveMember}
            onLeaveMembership={onLeaveMembership}
            containerRef={modalRef}
            draggable
            onDetachToWindow={onDetachToWindow}
          />
        )}
      </ModalContent>
    </Modal>
  );
}
