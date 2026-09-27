import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLanguageInitialization } from "@hooks/useLanguageInitialization";
import { checkForUpdatesWithPrompt, listSteamCatalogPage } from "@services/tauri";
import { toastSyncResult } from "@utils/toast";
import { notifySyncComplete, notifySyncError } from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";
import { useInputManager } from "@features/input/useInputManager";
import { initSyncListeners } from "@store/SyncStore";
import { initSourcesListeners } from "@store/SourcesDownloadsStore";
import { initTorrentListeners } from "@store/TorrentStore";
import { useCloudWebSockets } from "@hooks/useCloudWebSockets";
import { useCloudStreamRealtime } from "@hooks/useCloudStreamRealtime";
import { useCloudStreamHostSignaling } from "@hooks/useCloudStreamHostSignaling";
import { initGamesViewPreferences } from "@hooks/useGamesViewPreferences";
import { queryClient } from "@lib/queryClient";
import { STEAM_CATALOG_PAGE_SIZE } from "@/constants/constants";
import { useNotificationCloudSync } from "@hooks/useNotificationCloudSync";
import { useConfigCloudBackupSync } from "@hooks/useConfigCloudBackupSync";

/**
 * Hook encargado de inicializar comportamientos globales de la aplicación.
 *
 * Este hook centraliza tareas que deben ejecutarse automáticamente
 * cuando la app arranca.
 *
 * Funciones principales:
 *
 * - Respaldar en la nube la configuración cuando su contenido cambia.
 * - Comprobar actualizaciones de la aplicación (solo en producción).
 * - Escuchar eventos de sincronización automática emitidos desde el backend de Tauri.
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
  useLanguageInitialization();
  useInputManager();
  initSyncListeners();
  initSourcesListeners();
  initTorrentListeners();
  useCloudWebSockets();
  useNotificationCloudSync();
  useConfigCloudBackupSync();
  useCloudStreamRealtime();
  useCloudStreamHostSignaling();

  useEffect(() => {
    return initGamesViewPreferences();
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
   * Prefetch de la primera página del catálogo de Steam 1 segundo después del inicio.
   */
  useEffect(() => {
    const prefetchCatalog = async () => {
      try {
        const bigPictureConsole =
          typeof document !== "undefined" && document.documentElement.classList.contains("savecloud-big-picture");
        const pageSize = bigPictureConsole ? 25 : STEAM_CATALOG_PAGE_SIZE;
        const queryKey = ["steamCatalog", "browse", 1, "", "", pageSize];

        await queryClient.prefetchQuery({
          queryKey,
          queryFn: () => listSteamCatalogPage(0, pageSize, null, null, null),
          staleTime: 60 * 1000,
        });
        console.info("[useAppInitialization] Prefetched first catalog page (size: " + pageSize + ")");
      } catch (e) {
        console.warn("[SaveCloud:useAppInitialization] Prefetch catálogo error", e);
      }
    };

    const timer = setTimeout(() => {
      void prefetchCatalog();
    }, 1000);

    return () => clearTimeout(timer);
  }, []);
}
