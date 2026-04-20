import { Spinner } from "@heroui/react";
import "@styles/App.css";
import { ProfileStartupSelector } from "@features/profile/ProfileStartupSelector";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import { AppRuntime } from "@/app/AppRuntime";
import { useStartupProfileGate } from "@/app/hooks/useStartupProfileGate";

function AppAmbientBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <div className="absolute inset-0 bg-linear-to-br from-background via-default-50/55 to-default-100/80 dark:from-default-200/10 dark:via-default-100/5 dark:to-background" />
      <div className="absolute inset-0 backdrop-blur-sm" />
      <div className="relative min-h-dvh">{children}</div>
    </div>
  );
}

function App() {
  useProfileSessionHydration();
  const gate = useStartupProfileGate();

  const appReady = !gate.loading && !gate.visible;

  if (!appReady) {
    if (gate.visible) {
      return (
        <ProfileStartupSelector
          options={gate.options}
          selectingId={gate.selectingId}
          deletingId={gate.deletingId}
          creatingProfile={gate.creatingProfile}
          error={gate.error}
          onSelect={gate.onSelectProfile}
          onCreateProfile={gate.onCreateProfile}
          onDeleteProfile={gate.onDeleteProfile}
        />
      );
    }

    return (
      <AppAmbientBackground>
        <div className="flex min-h-dvh items-center justify-center text-default-500">
          <Spinner />
          <span className="ml-2">Cargando perfiles...</span>
        </div>
      </AppAmbientBackground>
    );
  }

  return (
    <AppAmbientBackground>
      <AppRuntime />
    </AppAmbientBackground>
  );
}

export default App;
