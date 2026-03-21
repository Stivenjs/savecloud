import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigationStore } from "@features/input/store";
import { SemanticAction } from "@features/input/types";

const NAVIGATION_THROTTLE_MS = 120;

export function useInputManager() {
  const { setInputMode, navigate, confirm, popLayer } = useNavigationStore();
  const mouseTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastGamepadInput = useRef<number>(0);
  const lastKeyInput = useRef<number>(0);

  useEffect(() => {
    const handleMouseMove = () => {
      setInputMode("mouse");
      if (mouseTimeout.current) clearTimeout(mouseTimeout.current);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isNavKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);

      if (isNavKey) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastKeyInput.current < NAVIGATION_THROTTLE_MS) return;
        lastKeyInput.current = now;
      }

      setInputMode("gamepad");

      switch (e.key) {
        case "ArrowUp":
          navigate("UP");
          break;
        case "ArrowDown":
          navigate("DOWN");
          break;
        case "ArrowLeft":
          navigate("LEFT");
          break;
        case "ArrowRight":
          navigate("RIGHT");
          break;
        case "Enter":
          confirm();
          break;
        case "Escape":
          popLayer();
          break;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);

    const unlisten = listen<{ action: SemanticAction; player: number }>("controller_action", (event) => {
      const now = Date.now();
      if (now - lastGamepadInput.current < NAVIGATION_THROTTLE_MS) return;
      lastGamepadInput.current = now;

      setInputMode("gamepad");

      switch (event.payload.action) {
        case "navigate_up":
          navigate("UP");
          break;
        case "navigate_down":
          navigate("DOWN");
          break;
        case "navigate_left":
          navigate("LEFT");
          break;
        case "navigate_right":
          navigate("RIGHT");
          break;
        case "confirm":
          confirm();
          break;
        case "back":
          popLayer();
          break;
      }
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      unlisten.then((f) => f());
    };
  }, [navigate, confirm, popLayer, setInputMode]);
}
