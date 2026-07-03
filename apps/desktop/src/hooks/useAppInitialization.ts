import { useEffect } from "react";
import { useLanguageInitialization } from "@hooks/useLanguageInitialization";
import { visibilityManager } from "@hooks/useAppVisibility";
import { listen } from "@tauri-apps/api/event";
import { NOTIFICATIONS_CHANGED_EVENT } from "@services/tauri/notifications.service";
import { backupConfigToCloud, checkForUpdatesWithPrompt } from "@services/tauri";
import { toastSyncResult } from "@utils/toast";
import { notifySyncComplete, notifySyncError } from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";
import { useInputManager } from "@features/input/useInputManager";
import { useNotificationStore } from "@store/NotificationStore";
import { initSyncListeners } from "@store/SyncStore";
import { initSourcesListeners } from "@store/SourcesDownloadsStore";
import { initTorrentListeners } from "@store/TorrentStore";
import { useCloudWebSockets } from "@hooks/useCloudWebSockets";
import { useCloudStreamRealtime } from "@hooks/useCloudStreamRealtime";
import { useCloudStreamHostSignaling } from "@hooks/useCloudStreamHostSignaling";
import { useProfileSessionStore } from "@store/ProfileSessionStore";

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
 * - Bloquear acciones de desarrollo en producción salvo «Modo desarrollador» del perfil activo (sesión).
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
  const developerMode = useProfileSessionStore((s) => s.activeProfile?.developerMode ?? false);
  useLanguageInitialization();
  useInputManager();
  initSyncListeners();
  initSourcesListeners();
  initTorrentListeners();
  useCloudWebSockets();
  useCloudStreamRealtime();
  useCloudStreamHostSignaling();

  /**
   * Contador de notificaciones + sync periódico con la API (multi-dispositivo).
   */
  useEffect(() => {
    const refresh = async () => {
      try {
        const activeProfile = useProfileSessionStore.getState().activeProfile;
        if (!activeProfile?.localUserId.trim() || !activeProfile.apiBaseUrl.trim()) {
          console.info("[SaveCloud:useAppInitialization] sync notificaciones omitido (falta userId o apiBaseUrl)", {
            hasUserId: !!activeProfile?.localUserId.trim(),
            hasApi: !!activeProfile?.apiBaseUrl.trim(),
          });
          return;
        }
        await useNotificationStore.getState().syncWithCloud();
      } catch (e) {
        console.warn("[SaveCloud:useAppInitialization] refresh notificaciones error", e);
      }
    };

    void useNotificationStore.getState().refreshUnreadCount();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void useNotificationStore.getState().refreshUnreadCount();
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    // Eliminar el timer completamente en background y recrearlo al volver.
    // Esto evita que V8 despierte innecesariamente cuando la app está minimizada.
    let intervalId: ReturnType<typeof setInterval> | null = setInterval(() => void refresh(), 120_000);

    const unsubVisibility = visibilityManager.subscribe(
      () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      },
      () => {
        void refresh();
        intervalId = setInterval(() => void refresh(), 120_000);
      }
    );

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsubVisibility();
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, []);

  /** Badge y lista del centro de notificaciones. Debounceado 500ms para evitar ráfagas de peticiones. */
  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleEvent = () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void useNotificationStore.getState().syncWithCloud();
      }, 500);
    };

    void listen(NOTIFICATIONS_CHANGED_EVENT, handleEvent).then((fn) => {
      if (!active) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (unlistenFn) unlistenFn();
    };
  }, []);
  /**
   * Respaldos periódicos de configuración del usuario.
   *
   * Esto evita pérdida de datos si el usuario cambia
   * de dispositivo o reinstala la aplicación.
   *
   * Frecuencia: cada 5 minutos.
   */
  useEffect(() => {
    const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
    const doBackup = () => backupConfigToCloud().catch(() => {});

    let intervalId: ReturnType<typeof setInterval> | null = setInterval(doBackup, BACKUP_INTERVAL_MS);

    const unsubVisibility = visibilityManager.subscribe(
      () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      },
      () => {
        intervalId = setInterval(doBackup, BACKUP_INTERVAL_MS);
      }
    );

    return () => {
      unsubVisibility();
      if (intervalId !== null) clearInterval(intervalId);
    };
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
        checkForUpdatesWithPrompt(true).catch(() => {});
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
  useEffect(() => {
    if (import.meta.env.DEV || developerMode) return;

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
  }, [developerMode]);
}
