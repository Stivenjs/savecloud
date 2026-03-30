import { MemoryRouter } from "react-router-dom";
import { AppLayout, TransferOverlayRouter } from "@components/layout";
import { NAV_ITEMS, AppRoutes } from "@components/navigation/PageContent";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import "./App.css";

function App() {
  useAppInitialization();

  return (
    <>
      <TrayActionsListener />
      <UnsyncedSavesModalWithProgress />

      <MemoryRouter>
        <AppLayout navItems={NAV_ITEMS}>
          <AppRoutes />
        </AppLayout>
      </MemoryRouter>

      <TransferOverlayRouter />
    </>
  );
}

export default App;
