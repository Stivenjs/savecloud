import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigationStore } from "@features/input/store";
import { SemanticAction } from "@features/input/types";
import { useShellUiStore } from "@store/ShellUiStore";

const NAVIGATION_THROTTLE_MS = 120;

function dispatchBackAction() {
  const shell = useShellUiStore.getState();
  if (shell.sideMenuOpen) {
    shell.requestCloseSideMenu();
    return;
  }
  shell.requestGlobalBack();
}

/**
 * Atajos de teclado (además del mando):
 * - Menú lateral: F10, Alt+M, o Ctrl+Shift+M (este último suele funcionar aunque el WebView se coma F10).
 * - Perfil (Juegos): Alt+P o Ctrl+Shift+P.
 *
 * El listener usa fase capture para recibir la pulsación antes que el SO/WebView la consuma.
 */
export function useInputManager() {
  const { setInputMode, navigate, confirm } = useNavigationStore();
  const mouseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGamepadInput = useRef<number>(0);
  const lastKeyInput = useRef<number>(0);

  useEffect(() => {
    const handleMouseMove = () => {
      if (useNavigationStore.getState().inputMode !== "mouse") {
        setInputMode("mouse");
      }
      if (mouseTimeout.current) clearTimeout(mouseTimeout.current);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.repeat) {
        const isMenuShortcut =
          e.code === "F10" ||
          e.key === "F10" ||
          (e.ctrlKey &&
            e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            (e.code === "KeyM" || e.key === "m" || e.key === "M")) ||
          (e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            (e.code === "KeyM" || e.key === "m" || e.key === "M"));

        if (isMenuShortcut) {
          e.preventDefault();
          e.stopPropagation();
          useShellUiStore.getState().requestStaggeredMenuToggle();
          return;
        }

        const isProfileShortcut =
          (e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            (e.code === "KeyP" || e.key === "p" || e.key === "P")) ||
          (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === "KeyP" || e.key === "p" || e.key === "P"));

        if (isProfileShortcut) {
          e.preventDefault();
          e.stopPropagation();
          useShellUiStore.getState().requestProfileOpen();
          return;
        }
      }

      const isNavKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);

      if (isNavKey) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastKeyInput.current < NAVIGATION_THROTTLE_MS) return;
        lastKeyInput.current = now;
      }

      if (useNavigationStore.getState().inputMode !== "gamepad") {
        setInputMode("gamepad");
      }

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
          e.preventDefault();
          dispatchBackAction();
          break;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("keydown", handleKeyDown, true);

    const unlisten = listen<{ action: SemanticAction; player: number }>("controller_action", (event) => {
      const now = Date.now();
      if (now - lastGamepadInput.current < NAVIGATION_THROTTLE_MS) return;
      lastGamepadInput.current = now;

      if (useNavigationStore.getState().inputMode !== "gamepad") {
        setInputMode("gamepad");
      }

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
          dispatchBackAction();
          break;
        case "menu":
          useShellUiStore.getState().requestStaggeredMenuToggle();
          break;
        case "profile":
          useShellUiStore.getState().requestProfileOpen();
          break;
      }
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("keydown", handleKeyDown, true);
      unlisten.then((f) => f());
    };
  }, [navigate, confirm, setInputMode]);
}
