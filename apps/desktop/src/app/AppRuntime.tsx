import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { HashRouter, useNavigate } from "react-router-dom";
import { AppLayout, TransferOverlayRouter } from "@components/layout";
import { AppRoutes } from "@router/AppRoutes";
import { NAV_ITEMS } from "@components/navigation/navItems";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useConfig } from "@hooks/useConfig";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import type { ConfiguredGame } from "@app-types/config";
import {
  SAVECLOUD_OPEN_RESTORE_FROM_CLOUD_EVENT,
  type SavecloudOpenRestoreFromCloudPayload,
} from "@/constants/savecloudCrossWindow";
import { useShellUiStore } from "@store/ShellUiStore";

function AppContent({ hideTitleBar }: { hideTitleBar: boolean }) {
  const navigate = useNavigate();
  const { config } = useConfig();

  const games = config?.games ?? [];

  const handleMenuGameClick = (game: ConfiguredGame) => {
    navigate(`/games/${game.id}`);
  };

  useEffect(() => {
    let unlistenOpenFriends: (() => void) | null = null;
    let unlistenOpenRoute: (() => void) | null = null;

    void listen("open-friends-page", () => {
      navigate("/friends");
    }).then((fn) => {
      unlistenOpenFriends = fn;
    });

    void listen<{ route: string }>("open-main-route", (event) => {
      const route = event.payload?.route?.trim();
      if (!route) return;
      navigate(route);
    }).then((fn) => {
      unlistenOpenRoute = fn;
    });

    let unlistenRestoreFromCloud: (() => void) | null = null;
    void listen<SavecloudOpenRestoreFromCloudPayload>(SAVECLOUD_OPEN_RESTORE_FROM_CLOUD_EVENT, (event) => {
      const gameId = event.payload?.gameId?.trim();
      if (!gameId) return;
      navigate("/");
      useShellUiStore.getState().requestOpenRestoreFromCloud(gameId);
      void WebviewWindow.getByLabel("main").then((w) => {
        void w?.setFocus().catch(() => {});
      });
    }).then((fn) => {
      unlistenRestoreFromCloud = fn;
    });

    return () => {
      unlistenOpenFriends?.();
      unlistenOpenRoute?.();
      unlistenRestoreFromCloud?.();
    };
  }, [navigate]);

  return (
    <AppLayout navItems={NAV_ITEMS} games={games} onMenuGameClick={handleMenuGameClick} hideTitleBar={hideTitleBar}>
      <AppRoutes />
    </AppLayout>
  );
}

interface AppRuntimeProps {
  hideTitleBar?: boolean;
}

export function AppRuntime({ hideTitleBar = false }: AppRuntimeProps) {
  useProfileSessionHydration();
  useAppInitialization();

  return (
    <>
      <TrayActionsListener />
      <UnsyncedSavesModalWithProgress />

      <HashRouter>
        <AppContent hideTitleBar={hideTitleBar} />
      </HashRouter>

      <TransferOverlayRouter />
    </>
  );
}
