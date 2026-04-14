import { MemoryRouter, useNavigate } from "react-router-dom";
import { AppLayout, TransferOverlayRouter } from "@components/layout";
import { AppRoutes } from "@components/navigation/PageContent";
import { NAV_ITEMS } from "@components/navigation/navItems";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useConfig } from "@hooks/useConfig";
import type { ConfiguredGame } from "@app-types/config";
import "@styles/App.css";

function AppContent() {
  const navigate = useNavigate();
  const { config } = useConfig();

  const games = config?.games ?? [];

  const handleMenuGameClick = (game: ConfiguredGame) => {
    navigate(`/games/${game.id}`);
  };

  return (
    <AppLayout navItems={NAV_ITEMS} games={games} onMenuGameClick={handleMenuGameClick}>
      <AppRoutes />
    </AppLayout>
  );
}

function App() {
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

export default App;
