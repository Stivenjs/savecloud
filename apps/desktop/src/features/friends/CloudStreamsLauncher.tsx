import { useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Radio } from "lucide-react";
import { CloudStreamsModal } from "@features/friends/CloudStreamsModal";

// EXPERIMENTAL: Cloud streaming UI is not part of the stable production release.

export function CloudStreamsLauncher() {
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLElement>(null as unknown as HTMLElement);

  return (
    <>
      <Button
        isIconOnly
        variant="light"
        radius="md"
        color="default"
        size="lg"
        className="text-foreground"
        aria-label="Abrir transmisiones cloud"
        onPress={() => setOpen(true)}>
        <Radio size={20} />
      </Button>

      <CloudStreamsModal isOpen={open} onClose={() => setOpen(false)} modalRef={modalRef} />
    </>
  );
}
