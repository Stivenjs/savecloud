import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, History, Info, Settings, Users } from "lucide-react";
import { AppLayout, type NavItem } from "@components/layout";
import { SyncProgressBar } from "@components/layout";
import { SyncProgressProvider } from "@contexts/SyncProgressContext";
import { GamesPage } from "@features/games";
import { FriendsPage } from "@features/friends/FriendsPage";
import { HistoryPage } from "@features/history/HistoryPage";
import { UnsyncedSavesModal } from "@features/games/UnsyncedSavesModal";
import { SettingsPage } from "@features/settings";
import { useSyncProgress } from "@contexts/SyncProgressContext";
import { useUnsyncedSaves } from "@hooks/useUnsyncedSaves";
import {
  backupConfigToCloud,
  checkForUpdatesWithPrompt,
  createAndUploadFullBackup,
  getConfig,
  syncDownloadAllGames,
  syncUploadGame,
  syncUploadAllGames,
} from "@services/tauri";
import {
  toastDownloadResult,
  toastError,
  toastSuccess,
  toastSyncResult,
} from "@utils/toast";
import {
  notifyBatchDownloadDone,
  notifyBatchUploadDone,
  notifyFullBackupDone,
  notifyFullBackupError,
  notifySyncComplete,
  notifySyncError,
  notifyUploadError,
} from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";
import { useQueryClient } from "@tanstack/react-query";

import "./App.css";

const NAV_ITEMS: NavItem[] = [
  { id: "games", label: "Juegos", icon: <Gamepad2 size={18} /> },
  { id: "friends", label: "Amigos", icon: <Users size={18} /> },
  { id: "history", label: "Historial", icon: <History size={18} /> },
  { id: "settings", label: "Configuración", icon: <Settings size={18} /> },
  { id: "about", label: "Acerca de", icon: <Info size={18} /> },
];

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

function PageContent({ activeId }: { activeId: string }) {
  switch (activeId) {
    case "games":
      return <GamesPage />;
    case "friends":
      return <FriendsPage />;
    case "history":
      return <HistoryPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-default-500">Sección en desarrollo</p>
        </div>
      );
  }
}

/** Ejecuta subir todo, descargar todo o backup del primer juego al elegir la acción en la bandeja. */
function TrayActionsListener() {
  const { setSyncOperation } = useSyncProgress();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubUpload = listen("tray-action-upload-all", async () => {
      setSyncOperation({ type: "upload", mode: "batch", gameId: null });
      let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
      try {
        const results = await syncUploadAllGames();
        totalResult = {
          okCount: results.reduce((s, r) => s + r.result.okCount, 0),
          errCount: results.reduce((s, r) => s + r.result.errCount, 0),
          errors: results.flatMap((r) => r.result.errors),
        };
        toastSyncResult(totalResult);
      } catch (e) {
        totalResult = {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        };
        toastSyncResult(totalResult);
      } finally {
        setSyncOperation(null);
        notifyBatchUploadDone(totalResult.okCount, totalResult.errCount).catch(
          () => {}
        );
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      }
    });

    const unsubDownload = listen("tray-action-download-all", async () => {
      setSyncOperation({ type: "download", mode: "batch", gameId: null });
      let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
      try {
        const results = await syncDownloadAllGames();
        totalResult = {
          okCount: results.reduce((s, r) => s + r.result.okCount, 0),
          errCount: results.reduce((s, r) => s + r.result.errCount, 0),
          errors: results.flatMap((r) => r.result.errors),
        };
        toastDownloadResult(totalResult);
      } catch (e) {
        totalResult = {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        };
        toastDownloadResult(totalResult);
      } finally {
        setSyncOperation(null);
        notifyBatchDownloadDone(
          totalResult.okCount,
          totalResult.errCount
        ).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      }
    });

    const unsubBackup = listen("tray-action-backup-first", async () => {
      let config;
      try {
        config = await getConfig();
      } catch {
        toastError("Error", "No se pudo leer la configuración.");
        return;
      }
      const firstGameId = config?.games?.[0]?.id;
      if (!firstGameId) {
        toastError(
          "Sin juegos",
          "Añade al menos un juego para hacer backup desde la bandeja."
        );
        return;
      }
      setSyncOperation({ type: "upload", mode: "single", gameId: firstGameId });
      try {
        await createAndUploadFullBackup(firstGameId);
        toastSuccess(
          "Backup completo subido",
          `${formatGameDisplayName(
            firstGameId
          )}: empaquetado subido desde la bandeja.`
        );
        notifyFullBackupDone(formatGameDisplayName(firstGameId)).catch(
          () => {}
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastError("Error al empaquetar y subir", msg);
        notifyFullBackupError(formatGameDisplayName(firstGameId), msg).catch(
          () => {}
        );
      } finally {
        setSyncOperation(null);
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        queryClient.invalidateQueries({
          queryKey: ["cloud-backups", firstGameId],
        });
        queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
      }
    });

    return () => {
      unsubUpload.then((f) => f());
      unsubDownload.then((f) => f());
      unsubBackup.then((f) => f());
    };
  }, [setSyncOperation, queryClient]);

  return null;
}

function UnsyncedSavesModalWithProgress() {
  const { setSyncOperation } = useSyncProgress();
  const {
    unsyncedGameIds,
    showUnsyncedModal,
    closeModal,
    uploadAll,
    isUploading,
    refetchUnsynced,
  } = useUnsyncedSaves();
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);

  const handleUploadAll = useCallback(async () => {
    setSyncOperation({ type: "upload", mode: "batch", gameId: null });
    try {
      await uploadAll();
    } finally {
      setSyncOperation(null);
    }
  }, [uploadAll, setSyncOperation]);

  const handleUploadGame = useCallback(
    async (gameId: string) => {
      setLoadingGameId(gameId);
      setSyncOperation({ type: "upload", mode: "single", gameId });
      try {
        const result = await syncUploadGame(gameId);
        toastSyncResult(result, formatGameDisplayName(gameId));
        await refetchUnsynced();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastSyncResult(
          {
            okCount: 0,
            errCount: 1,
            errors: [msg],
          },
          formatGameDisplayName(gameId)
        );
        notifyUploadError(formatGameDisplayName(gameId), msg).catch(() => {});
      } finally {
        setLoadingGameId(null);
        setSyncOperation(null);
      }
    },
    [refetchUnsynced, setSyncOperation]
  );

  const handleFullBackupGame = useCallback(
    async (gameId: string) => {
      setLoadingGameId(gameId);
      setSyncOperation({ type: "upload", mode: "single", gameId });
      try {
        await createAndUploadFullBackup(gameId);
        toastSuccess(
          "Backup completo subido",
          `${formatGameDisplayName(gameId)}: empaquetado subido a la nube.`
        );
        await refetchUnsynced();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastError("Error al empaquetar y subir", msg);
        notifyFullBackupError(formatGameDisplayName(gameId), msg).catch(
          () => {}
        );
      } finally {
        setLoadingGameId(null);
        setSyncOperation(null);
      }
    },
    [refetchUnsynced, setSyncOperation]
  );

  return (
    <UnsyncedSavesModal
      isOpen={showUnsyncedModal}
      onClose={closeModal}
      gameIds={unsyncedGameIds}
      onUploadAll={handleUploadAll}
      onUploadGame={handleUploadGame}
      onFullBackupGame={handleFullBackupGame}
      isLoadingAll={isUploading}
      loadingGameId={loadingGameId}
    />
  );
}

function App() {
  const [activeNavId, setActiveNavId] = useState("games");

  // Respaldo periódico del config a la nube (cada 5 min) para mantenerlo actualizado
  useEffect(() => {
    const interval = setInterval(() => {
      backupConfigToCloud().catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Evitar menú contextual (clic derecho) y F5/Ctrl+R para que se comporte como app de escritorio solo en producción
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    const preventRefresh = (e: KeyboardEvent) => {
      if (
        e.key === "F5" ||
        (e.ctrlKey && e.key.toLowerCase() === "r") ||
        (e.metaKey && e.key.toLowerCase() === "r")
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventRefresh);
    return () => {
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("keydown", preventRefresh);
    };
  }, []);

  // Comprobar actualizaciones al iniciar (solo en producción)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      const t = setTimeout(() => {
        checkForUpdatesWithPrompt(true).catch(() => {
          // Error silencioso: endpoint no configurado o sin conexión
        });
      }, 2000);
      return () => clearTimeout(t);
    }
  }, []);

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
    const unsubErr = listen<{ gameId: string; error: string }>(
      "auto-sync-error",
      (ev) => {
        const gameName = formatGameDisplayName(ev.payload.gameId);
        toastSyncResult(
          { okCount: 0, errCount: 1, errors: [ev.payload.error] },
          gameName
        );
        notifySyncError(gameName, ev.payload.error);
      }
    );
    return () => {
      unsubDone.then((f) => f());
      unsubErr.then((f) => f());
    };
  }, []);

  return (
    <SyncProgressProvider>
      <TrayActionsListener />
      <UnsyncedSavesModalWithProgress />
      <AppLayout
        navItems={NAV_ITEMS}
        activeNavId={activeNavId}
        onNavSelect={setActiveNavId}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeNavId}
            initial={pageTransition.initial}
            animate={pageTransition.animate}
            exit={pageTransition.exit}
            transition={pageTransition.transition}
            className="min-h-[50vh]"
          >
            <PageContent activeId={activeNavId} />
          </motion.div>
        </AnimatePresence>
      </AppLayout>

      <SyncProgressBar />
    </SyncProgressProvider>
  );
}

export default App;
