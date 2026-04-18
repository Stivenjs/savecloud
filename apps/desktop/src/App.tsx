import { Spinner } from "@heroui/react";
import "@styles/App.css";
import { ProfileStartupSelector } from "@features/profile/ProfileStartupSelector";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import { AppRuntime } from "@/app/AppRuntime";
import { useStartupProfileGate } from "@/app/hooks/useStartupProfileGate";

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
          creatingProfile={gate.creatingProfile}
          error={gate.error}
          onSelect={gate.onSelectProfile}
          onCreateProfile={gate.onCreateProfile}
        />
      );
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-default-500">
        <Spinner />
        <span className="ml-2">Cargando perfiles...</span>
      </div>
    );
  }

  return <AppRuntime />;
}

export default App;
