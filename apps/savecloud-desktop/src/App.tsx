import { MemoryRouter } from "react-router-dom";
import { AppLayout, SyncProgressBar } from "@components/layout";
import { SyncProgressProvider } from "@contexts/SyncProgressContext";
import { NAV_ITEMS, AppRoutes } from "@components/navigation/PageContent";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import "./App.css";

function App() {
  useAppInitialization();

  return (
    <SyncProgressProvider>
      <TrayActionsListener />
      <UnsyncedSavesModalWithProgress />

      <MemoryRouter>
        <AppLayout navItems={NAV_ITEMS}>
          <AppRoutes />
        </AppLayout>
      </MemoryRouter>

      <SyncProgressBar />
    </SyncProgressProvider>
  );
}

export default App;
