import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigationStore } from "@features/input/store";
import type { SemanticAction } from "@features/input/types";
import { featureFlags } from "@/constants/featureFlags";
import { toggleSettingsWindowFromBigPicture } from "@/windows/settingsWindow";
import { useShellUiStore } from "@store/ShellUiStore";

const NAVIGATION_THROTTLE_MS = 120;

function dispatchBackAction() {
  useShellUiStore.getState().dispatchBackNavigation();
}

function ensureGamepadShellMode(setInputMode: (m: "gamepad" | "mouse") => void) {
  if (useNavigationStore.getState().inputMode !== "gamepad") {
    setInputMode("gamepad");
  }
}

function isTypingInInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

/**
 * Atajos de teclado (además del mando):
 * - Menú lateral: F10, Alt+M, o Ctrl+Shift+M.
 * - Perfil abrir (no toggle): Alt+P o Ctrl+Shift+P.
 *
 * Listener de mando (`controller_action`) siempre activo: menú, atrás, opciones, perfil (toggle).
 * La navegación espacial (`navigate_*`, `confirm` completa) sólo cuando `featureFlags.gamepadNavigation`.
 * Sin ese flag, `confirm` sigue llegando como `confirmFocusedNodeFromHud` para Big Picture HUD.
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

      if (!isTypingInInput(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (e.key === "x" || e.key === "X") {
          e.preventDefault();
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_action_x"));
          return;
        }
        if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_action_y"));
          return;
        }
      }

      const isNavKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      const isNavConfirmBackKey = isNavKey || e.key === "Enter" || e.key === "Escape";

      if (!featureFlags.gamepadNavigation && isNavConfirmBackKey) {
        return;
      }

      if (isNavKey) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastKeyInput.current < NAVIGATION_THROTTLE_MS) return;
        lastKeyInput.current = now;
      }

      if (isNavConfirmBackKey && useNavigationStore.getState().inputMode !== "gamepad") {
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
        case "PageUp":
        case "[":
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent("gamepad_page_left"));
          break;
        case "PageDown":
        case "]":
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent("gamepad_page_right"));
          break;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("keydown", handleKeyDown, true);

    const unlisten = listen<{ action: SemanticAction; player: number }>("controller_action", (event) => {
      const action = event.payload.action;

      switch (action) {
        case "menu":
          ensureGamepadShellMode(setInputMode);
          useShellUiStore.getState().requestStaggeredMenuToggle();
          return;
        case "options":
          ensureGamepadShellMode(setInputMode);
          void toggleSettingsWindowFromBigPicture();
          return;
        case "profile":
          ensureGamepadShellMode(setInputMode);
          useShellUiStore.getState().requestProfileToggle();
          return;
        case "back":
          ensureGamepadShellMode(setInputMode);
          dispatchBackAction();
          return;
        case "action_x":
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_action_x"));
          return;
        case "action_y":
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_action_y"));
          return;
        case "page_left":
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_page_left"));
          return;
        case "page_right":
          ensureGamepadShellMode(setInputMode);
          window.dispatchEvent(new CustomEvent("gamepad_page_right"));
          return;
        default:
          break;
      }

      if (!featureFlags.gamepadNavigation) {
        if (action === "confirm") {
          if (useNavigationStore.getState().confirmFocusedNodeFromHud()) ensureGamepadShellMode(setInputMode);
        }
        return;
      }

      const now = Date.now();
      if (now - lastGamepadInput.current < NAVIGATION_THROTTLE_MS) return;
      lastGamepadInput.current = now;

      ensureGamepadShellMode(setInputMode);

      switch (action) {
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
      }
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("keydown", handleKeyDown, true);
      void unlisten.then((f) => f());
    };
  }, [navigate, confirm, setInputMode]);
}
