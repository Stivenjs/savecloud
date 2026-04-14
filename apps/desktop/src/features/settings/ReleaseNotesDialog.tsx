import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import RELEASE_NOTES_MARKDOWN from "@/assets/RELEASE_NOTES.md?raw";

interface ReleaseNotesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReleaseNotesDialog({ isOpen, onClose }: ReleaseNotesDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
      size="2xl"
      scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 text-left">Notas de versión</ModalHeader>

        <ModalBody className="max-h-[70vh] overflow-y-auto pb-6">
          <div className="prose prose-sm max-w-full p-4 text-default-600 prose-pre:bg-default-100 prose-pre:p-2 prose-pre:rounded-md overflow-auto">
            <ReactMarkdown>{RELEASE_NOTES_MARKDOWN}</ReactMarkdown>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
