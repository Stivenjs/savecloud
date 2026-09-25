import { useEffect } from "react";
import { AppRuntime } from "@/app/AppRuntime";
import { BigPictureControlHints } from "@/features/big-picture/BigPictureControlHints";
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
      <AppRuntime hideTitleBar />
      <BigPictureControlHints />
    </div>
  );
}
