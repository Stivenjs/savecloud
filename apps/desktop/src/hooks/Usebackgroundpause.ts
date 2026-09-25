import { useEffect } from "react";
import { visibilityManager } from "@hooks/useAppVisibility";

export function useBackgroundPause() {
  useEffect(() => {
    const el = document.documentElement;

    // Estado inicial: si la app ya está en background al montar, pausar ya.
    if (!visibilityManager.isVisible) {
      el.classList.add("paused-bg");
    }

    const unsub = visibilityManager.subscribe(
      () => el.classList.add("paused-bg"), // onPause
      () => el.classList.remove("paused-bg") // onResume
    );

    return () => {
      unsub();
      // Limpiar la clase al desmontar para no dejar la UI bloqueada.
      el.classList.remove("paused-bg");
    };
  }, []);
}
