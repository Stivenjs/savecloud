import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import { useProfileSessionHydration } from "@hooks/useProfileSession";

/**
 * Evento emitido cuando cambia el estado de «Modo desarrollador» en cualquier ventana.
 */
export const DEVELOPER_MODE_CHANGED_EVENT = "developer-mode-changed";

/**
 * Hook encargado de bloquear atajos de depuración/recarga y el menú contextual
 * en producción cuando el «Modo desarrollador» del perfil activo está desactivado.
 *
 * Se aplica en el nivel raíz de cada ventana (MainAppWrapper, OverlayWrapper, etc.)
 * para garantizar cobertura total e instantánea en todas las webviews de la aplicación.
 */
export function useDeveloperModeProtection(): void {
  useProfileSessionHydration();

  const developerMode = useProfileSessionStore((s) => s.activeProfile?.developerMode ?? false);

  // Escuchar cambios de modo desarrollador emitidos desde el backend para sincronizar todas las ventanas
  useEffect(() => {
    let unlistenDevMode: (() => void) | undefined;
    let unlistenConfig: (() => void) | undefined;

    void listen<boolean>(DEVELOPER_MODE_CHANGED_EVENT, (event) => {
      const enabled = Boolean(event.payload);
      useProfileSessionStore.getState().patchSession({ developerMode: enabled });
    }).then((fn) => {
      unlistenDevMode = fn;
    });

    void listen("config-changed", () => {
      void useProfileSessionStore.getState().hydrateSession();
    }).then((fn) => {
      unlistenConfig = fn;
    });

    return () => {
      unlistenDevMode?.();
      unlistenConfig?.();
    };
  }, []);

  /**
   * Bloquea acciones de desarrollo en producción salvo que el perfil activo tenga developerMode activo.
   */
  useEffect(() => {
    if (import.meta.env.DEV || developerMode) {
      return;
    }

    const blockKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (
        e.key === "F5" ||
        e.key === "F12" ||
        (isCtrlOrMeta && key === "r") ||
        (isCtrlOrMeta && e.shiftKey && key === "r") ||
        (isCtrlOrMeta && e.shiftKey && key === "i") ||
        (isCtrlOrMeta && e.shiftKey && key === "c") ||
        (isCtrlOrMeta && e.shiftKey && key === "j") ||
        (isCtrlOrMeta && key === "u")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", blockKeys, true);
    window.addEventListener("contextmenu", blockContextMenu, true);

    return () => {
      window.removeEventListener("keydown", blockKeys, true);
      window.removeEventListener("contextmenu", blockContextMenu, true);
    };
  }, [developerMode]);
}
