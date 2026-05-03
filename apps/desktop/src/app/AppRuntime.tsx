import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { AppLayout, TransferOverlayRouter } from "@components/layout";
import { AppRoutes } from "@router/AppRoutes";
import { NAV_ITEMS } from "@components/navigation/navItems";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useConfig } from "@hooks/useConfig";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import type { ConfiguredGame } from "@app-types/config";

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

    return () => {
      unlistenOpenFriends?.();
      unlistenOpenRoute?.();
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

      <MemoryRouter>
        <AppContent hideTitleBar={hideTitleBar} />
      </MemoryRouter>

      <TransferOverlayRouter />
    </>
  );
}
