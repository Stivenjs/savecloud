import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, History, Info, Settings, Users } from "lucide-react";
import { AppLayout, type NavItem } from "@components/layout";
import { GamesPage } from "@features/games";
import { FriendsPage } from "@features/friends/FriendsPage";
import { HistoryPage } from "@features/history/HistoryPage";
import { UnsyncedSavesModal } from "@features/games/UnsyncedSavesModal";
import { SettingsPage } from "@features/settings";
import { useUnsyncedSaves } from "@hooks/useUnsyncedSaves";
import {
  backupConfigToCloud,
  checkForUpdatesWithPrompt,
} from "@services/tauri";
import { toastSyncResult } from "@utils/toast";
import { notifySyncComplete, notifySyncError } from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";

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

function App() {
  const [activeNavId, setActiveNavId] = useState("games");
  const {
    unsyncedGameIds,
    showUnsyncedModal,
    closeModal,
    uploadAll,
    isUploading,
  } = useUnsyncedSaves();

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
    <>
      <UnsyncedSavesModal
        isOpen={showUnsyncedModal}
        onClose={closeModal}
        gameIds={unsyncedGameIds}
        onUploadAll={uploadAll}
        isLoading={isUploading}
      />
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
    </>
  );
}

export default App;
