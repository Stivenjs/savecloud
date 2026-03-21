import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { backupConfigToCloud, checkForUpdatesWithPrompt } from "@services/tauri";
import { toastSyncResult } from "@utils/toast";
import { notifySyncComplete, notifySyncError } from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";
import { useInputManager } from "@features/input/useInputManager";

/**
 * Hook encargado de inicializar comportamientos globales de la aplicación.
 *
 * Este hook centraliza tareas que deben ejecutarse automáticamente
 * cuando la app arranca.
 *
 * Funciones principales:
 *
 * - Respaldar periódicamente la configuración del usuario en la nube.
 * - Comprobar actualizaciones de la aplicación (solo en producción).
 * - Escuchar eventos de sincronización automática emitidos desde el backend de Tauri.
 * - Bloquear acciones de desarrollo en producción (reload, devtools, click derecho).
 *
 * Debe usarse una sola vez en el nivel raíz de la aplicación
 * (por ejemplo en `App.tsx`).
 *
 * @example
 * ```tsx
 * function App() {
 *   useAppInitialization();
 *   return <Router />;
 * }
 * ```
 */
export function useAppInitialization() {
  useInputManager();
  /**
   * Respaldos periódicos de configuración del usuario.
   *
   * Esto evita pérdida de datos si el usuario cambia
   * de dispositivo o reinstala la aplicación.
   *
   * Frecuencia: cada 5 minutos.
   */
  useEffect(() => {
    const interval = setInterval(
      () => {
        backupConfigToCloud().catch(() => {
          // Ignorar errores silenciosamente
        });
      },
      5 * 60 * 1000
    );

    return () => clearInterval(interval);
  }, []);

  /**
   * Comprueba si hay nuevas versiones disponibles.
   *
   * - Solo en producción
   * - Se ejecuta 2 segundos después del arranque
   */
  useEffect(() => {
    if (!import.meta.env.DEV) {
      const timer = setTimeout(() => {
        checkForUpdatesWithPrompt(true).catch(() => {
          // Ignorar errores
        });
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, []);

  /**
   * Escucha eventos emitidos desde el backend de Tauri
   * relacionados con sincronización automática.
   */
  useEffect(() => {
    const unsubDone = listen<{
      gameId: string;
      okCount: number;
      errCount: number;
    }>("auto-sync-done", (ev) => {
      const gameName = formatGameDisplayName(ev.payload.gameId);

      toastSyncResult(
        {
          okCount: ev.payload.okCount,
          errCount: ev.payload.errCount,
          errors: [],
        },
        gameName
      );

      notifySyncComplete(gameName, ev.payload.okCount, ev.payload.errCount);
    });

    const unsubErr = listen<{
      gameId: string;
      error: string;
    }>("auto-sync-error", (ev) => {
      const gameName = formatGameDisplayName(ev.payload.gameId);

      toastSyncResult(
        {
          okCount: 0,
          errCount: 1,
          errors: [ev.payload.error],
        },
        gameName
      );

      notifySyncError(gameName, ev.payload.error);
    });

    return () => {
      unsubDone.then((f) => f());
      unsubErr.then((f) => f());
    };
  }, []);

  /**
   * Bloquea acciones de desarrollo en producción.
   *
   * Evita que el usuario pueda:
   * - Recargar la app (F5 / Ctrl+R)
   * - Abrir DevTools (F12 / Ctrl+Shift+I)
   * - Abrir inspector (Ctrl+Shift+C)
   * - Abrir menú contextual (click derecho)
   */
  /*useEffect(() => {
    if (import.meta.env.DEV) return;

    const blockKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (
        e.key === "F5" ||
        e.key === "F12" ||
        (e.ctrlKey && key === "r") ||
        (e.ctrlKey && e.shiftKey && key === "r") ||
        (e.ctrlKey && e.shiftKey && key === "i") ||
        (e.ctrlKey && e.shiftKey && key === "c")
      ) {
        e.preventDefault();
      }
    };

    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", blockKeys);
    window.addEventListener("contextmenu", blockContextMenu);

    return () => {
      window.removeEventListener("keydown", blockKeys);
      window.removeEventListener("contextmenu", blockContextMenu);
    };
  }, []);*/
}
