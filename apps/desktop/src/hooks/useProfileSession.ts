import { useEffect } from "react";
import { useProfileSessionStore } from "@store/ProfileSessionStore";

export function useProfileSessionHydration() {
  const hydrateSession = useProfileSessionStore((state) => state.hydrateSession);

  useEffect(() => {
    void hydrateSession();
  }, [hydrateSession]);
}

export function useProfileSession() {
  const loading = useProfileSessionStore((state) => state.loading);
  const activeProfile = useProfileSessionStore((state) => state.activeProfile);
  const source = useProfileSessionStore((state) => state.source);
  const error = useProfileSessionStore((state) => state.error);

  return {
    loading,
    activeProfile,
    source,
    error,
  };
}
