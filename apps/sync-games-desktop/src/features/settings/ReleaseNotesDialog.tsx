import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@heroui/react";
import RELEASE_NOTES_MARKDOWN from "../../../../../RELEASE_NOTES.md?raw";

interface ReleaseNotesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Parsea markdown muy básico (##, ###, -) y lo muestra en el modal.
 */
function parseAndRender(md: string) {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      nodes.push(
        <ul key={key++} className="ml-4 list-disc space-y-1 text-sm text-default-600">
          {listItems.map((text, i) => (
            <li key={i}>{text.trim().replace(/^-\s*/, "")}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      flushList();
      nodes.push(
        <h1 key={key++} className="mt-2 text-lg font-semibold text-foreground">
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      nodes.push(
        <h2
          key={key++}
          className="mt-4 border-b border-default-200 pb-1 text-base font-semibold text-foreground first:mt-0"
        >
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      flushList();
      nodes.push(
        <h3 key={key++} className="mt-3 text-sm font-medium text-foreground">
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith("- ")) {
      listItems.push(trimmed);
    } else if (trimmed === "---") {
      flushList();
      nodes.push(<hr key={key++} className="my-4 border-default-200" />);
    } else if (trimmed) {
      flushList();
      nodes.push(
        <p key={key++} className="text-sm text-default-600">
          {trimmed}
        </p>
      );
    }
  }
  flushList();
  return nodes;
}

export function ReleaseNotesDialog({ isOpen, onClose }: ReleaseNotesDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
      size="2xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 text-left">
          Notas de versión
        </ModalHeader>
        <ModalBody className="max-h-[70vh] overflow-y-auto pb-6">
          <div className="space-y-1 pr-2">
            {parseAndRender(RELEASE_NOTES_MARKDOWN)}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
