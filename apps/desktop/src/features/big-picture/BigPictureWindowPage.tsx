import { useEffect } from "react";
import { Button } from "@heroui/react";
import { Minimize2 } from "lucide-react";
import { AppRuntime } from "@/app/AppRuntime";
import { switchToNormalMode } from "@/windows/bigPictureWindow";

export function BigPictureWindowPage() {
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      void switchToNormalMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed right-4 top-3 z-1000">
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={<Minimize2 size={14} />}
          onPress={() => void switchToNormalMode()}>
          Modo normal
        </Button>
      </div>
      <AppRuntime />
    </div>
  );
}
