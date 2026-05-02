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
import type { ConfiguredGame } from "@app-types/config";

function AppContent() {
  const navigate = useNavigate();
  const { config } = useConfig();

  const games = config?.games ?? [];

  const handleMenuGameClick = (game: ConfiguredGame) => {
    navigate(`/games/${game.id}`);
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("open-friends-page", () => {
      navigate("/friends");
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [navigate]);

  return (
    <AppLayout navItems={NAV_ITEMS} games={games} onMenuGameClick={handleMenuGameClick}>
      <AppRoutes />
    </AppLayout>
  );
}

export function AppRuntime() {
  useAppInitialization();

  return (
    <>
      <TrayActionsListener />
      <UnsyncedSavesModalWithProgress />

      <MemoryRouter>
        <AppContent />
      </MemoryRouter>

      <TransferOverlayRouter />
    </>
  );
}
