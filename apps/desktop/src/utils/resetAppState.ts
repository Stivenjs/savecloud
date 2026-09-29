import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { queryClient } from "@lib/queryClient";
import { useShellUiStore } from "@store/ShellUiStore";
import { useGameSessionStore } from "@store/GameSessionStore";
import { useSyncStore } from "@store/SyncStore";
import { useSaveGraphStore } from "@store/SaveGraphStore";
import { useCloudStreamStore } from "@store/CloudStreamStore";
import { useStreamingMetricsStore } from "@store/StreamingMetricsStore";
import { useTorrentStore } from "@store/TorrentStore";
import { useSourcesDownloadsStore } from "@store/SourcesDownloadsStore";
import { SETTINGS_WINDOW_LABEL } from "@/windows/settingsWindow";
import { FRIENDS_WINDOW_LABEL } from "@/windows/friendsWindow";
import { STREAMING_WINDOW_LABEL } from "@/windows/streamingWindow";
import { BIG_PICTURE_WINDOW_LABEL } from "@/windows/bigPictureWindow";

/**
 * Labels de ventanas secundarias conocidas que deben cerrarse al cambiar de perfil.
 * La ventana principal ("main") NUNCA se cierra.
 */
const KNOWN_SECONDARY_WINDOW_LABELS = [
  SETTINGS_WINDOW_LABEL,
  FRIENDS_WINDOW_LABEL,
  STREAMING_WINDOW_LABEL,
  BIG_PICTURE_WINDOW_LABEL,
] as const;

/**
 * Cierra silenciosamente una ventana secundaria por su label, si existe.
 */
async function closeWindowSilently(label: string): Promise<void> {
  try {
    const w = await WebviewWindow.getByLabel(label);
    if (w) {
      await w.close();
    }
  } catch {
    /* La ventana puede haber sido cerrada previamente o no existir. */
  }
}

/**
 * Cierra todas las ventanas secundarias abiertas (Settings, Friends, Streaming, Big Picture, Viewers, etc.).
 */
async function closeAllSecondaryWindows(): Promise<void> {
  try {
    const allWindows = await getAllWebviewWindows();
    const closePromises = allWindows.filter((w) => w.label !== "main").map((w) => w.close().catch(() => {}));
    await Promise.allSettled(closePromises);
  } catch {
    /* ignore */
  }

  // Asegurar el cierre de labels fijos por si alguno no figura en getAllWebviewWindows
  await Promise.allSettled(KNOWN_SECONDARY_WINDOW_LABELS.map(closeWindowSilently));
}

/**
 * Reinicia todo el estado de la aplicación al cambiar de perfil o cerrar sesión.
 *
 * Esto incluye:
 * - Limpiar la caché de TanStack Query
 * - Resetear todos los Zustand stores a su estado inicial
 * - Cerrar todas las ventanas secundarias abiertas (Settings, Friends, Streaming, Big Picture, etc.)
 * - Resetear la ruta de HashRouter al inicio ("#/") para no quedar atrapado en detalles de juegos u otras páginas
 */
export async function resetAppStateForProfileSwitch(): Promise<void> {
  // 1. Limpiar toda la caché de queries (datos del perfil anterior)
  queryClient.clear();

  // 2. Resetear stores de UI y estado efímero
  useShellUiStore.setState({
    libraryAmbientArtworkUrls: [],
    gamesBpSearchTerm: "",
    gamesBpSearchSetValue: null,
    catalogBpSearchTerm: "",
    catalogBpSearchSetValue: null,
    staggeredMenuToggleRequest: 0,
    profileOpenRequest: 0,
    profileToggleRequest: 0,
    sideMenuOpen: false,
    sideMenuCloseRequest: 0,
    backHandlers: [],
    scrollPositions: {},
    catalogScrollPosition: 0,
    libraryScrollPosition: 0,
    openRestoreFromCloudRequest: 0,
    openRestoreFromCloudGameId: null,
  });

  // 3. Resetear sesiones de juegos locales y presencia
  useGameSessionStore.setState({
    localSessionStartTimes: {},
    presenceSessionStartTimes: {},
  });

  // 4. Resetear operaciones de sincronización
  useSyncStore.setState({
    syncOperation: null,
    progress: null,
    activeTasksById: {},
    activeCount: 0,
    aggregateProgress: { loaded: 0, total: 0, percent: 0 },
    pausedUploadInfo: null,
  });

  // 5. Resetear grafos de guardados
  useSaveGraphStore.getState().reset();

  // 6. Resetear streams en la nube
  useCloudStreamStore.getState().clearStreams();

  // 7. Resetear métricas de streaming
  useStreamingMetricsStore.setState({
    currentMetrics: null,
    isModalOpen: false,
    history: [],
  });

  // 8. Resetear torrents activos
  useTorrentStore.setState({
    progress: null,
    activeByHash: {},
    activeCount: 0,
    tombstones: new Set(),
  });

  // 9. Resetear descargas de sources
  useSourcesDownloadsStore.setState({
    lastProgress: null,
    activeByJobId: {},
    activeCount: 0,
    tombstones: new Set(),
    aggregateProgress: { loaded: 0, total: 0, percent: 0 },
    syncProgress: null,
  });

  // 10. Resetear ruta hash al inicio ("#/")
  if (typeof window !== "undefined") {
    try {
      if (window.location.hash && window.location.hash !== "#/" && window.location.hash !== "#") {
        window.location.replace("#/");
      }
    } catch {
      /* ignore */
    }
  }

  // 11. Cerrar todas las ventanas secundarias
  await closeAllSecondaryWindows();
}
