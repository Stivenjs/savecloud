import { create } from "zustand";
import { useEffect, useState } from "react";
import { formatSessionDuration } from "@utils/format";

interface GameSessionState {
  /**
   * Timestamps (ms) de inicio de sesión de juegos locales en ejecución.
   * Key: gameId en minúsculas.
   */
  localSessionStartTimes: Record<string, number>;

  /**
   * Timestamps (ms) de inicio de sesión de amigos / usuarios en la nube.
   * Key: userId.
   */
  presenceSessionStartTimes: Record<string, { gameId?: string | null; startedAt: number }>;

  /** Registra o limpia el estado de ejecución de un juego local */
  setLocalGameRunning: (gameId: string, isRunning: boolean) => void;

  /** Sincroniza un mapa completo de juegos locales en ejecución */
  syncLocalRunningMap: (map: Record<string, boolean>) => void;

  /** Registra la presencia recibida para un usuario */
  recordPresence: (userId: string, status: string, gameId?: string | null, lastSeenAt?: number | null) => void;
}

export const useGameSessionStore = create<GameSessionState>((set) => ({
  localSessionStartTimes: {},
  presenceSessionStartTimes: {},

  setLocalGameRunning: (gameId: string, isRunning: boolean) => {
    const key = gameId.trim().toLowerCase();
    if (!key) return;

    set((state) => {
      const next = { ...state.localSessionStartTimes };
      if (isRunning) {
        if (!next[key]) {
          next[key] = Date.now();
        }
      } else {
        delete next[key];
      }
      return { localSessionStartTimes: next };
    });
  },

  syncLocalRunningMap: (map: Record<string, boolean>) => {
    const now = Date.now();
    set((state) => {
      const next = { ...state.localSessionStartTimes };
      let changed = false;

      // Actualizar los que están corriendo
      for (const [rawId, isRunning] of Object.entries(map)) {
        const key = rawId.trim().toLowerCase();
        if (!key) continue;

        if (isRunning) {
          if (!next[key]) {
            next[key] = now;
            changed = true;
          }
        } else if (next[key]) {
          delete next[key];
          changed = true;
        }
      }

      // Limpiar cualquier juego que ya no esté en el mapa
      for (const key of Object.keys(next)) {
        const matchingRaw = Object.keys(map).find((k) => k.trim().toLowerCase() === key);
        if (matchingRaw && !map[matchingRaw]) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? { localSessionStartTimes: next } : state;
    });
  },

  recordPresence: (userId: string, status: string, gameId?: string | null, lastSeenAt?: number | null) => {
    const uKey = userId.trim();
    if (!uKey) return;

    set((state) => {
      const current = state.presenceSessionStartTimes[uKey];
      const normalizedGameId = gameId?.trim() || null;

      if (status === "playing") {
        if (!current || current.gameId !== normalizedGameId) {
          // Si tenemos lastSeenAt razonable del backend que sea reciente, úsalo, sino Date.now()
          const now = Date.now();
          const startedAt = lastSeenAt && lastSeenAt > 0 && now - lastSeenAt < 4 * 60 * 60 * 1000 ? lastSeenAt : now;
          return {
            presenceSessionStartTimes: {
              ...state.presenceSessionStartTimes,
              [uKey]: { gameId: normalizedGameId, startedAt },
            },
          };
        }
        return state;
      }

      if (current) {
        const next = { ...state.presenceSessionStartTimes };
        delete next[uKey];
        return { presenceSessionStartTimes: next };
      }

      return state;
    });
  },
}));

export interface UseGameSessionDurationOptions {
  gameId?: string | null;
  userId?: string | null;
  fallbackStartedAt?: number | null;
  isRunning?: boolean;
}

/**
 * Hook reactivo para obtener los segundos y la duración formateada de la sesión activa.
 * Se actualiza cada segundo mientras el juego esté en ejecución.
 */
export function useGameSessionDuration(options: UseGameSessionDurationOptions) {
  const { gameId, userId, fallbackStartedAt, isRunning } = options;

  const localTimes = useGameSessionStore((s) => s.localSessionStartTimes);
  const presenceTimes = useGameSessionStore((s) => s.presenceSessionStartTimes);

  const localKey = gameId?.trim().toLowerCase() || "";
  const userKey = userId?.trim() || "";

  const startedAt =
    (localKey && localTimes[localKey]) || (userKey && presenceTimes[userKey]?.startedAt) || fallbackStartedAt || null;

  const active = Boolean((isRunning ?? (localKey && localTimes[localKey])) || (userKey && presenceTimes[userKey]));

  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active || !startedAt) return;

    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [active, startedAt]);

  const sessionSeconds = active && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const formattedDuration = formatSessionDuration(sessionSeconds);

  return {
    startedAt,
    sessionSeconds,
    formattedDuration,
    isActive: active && sessionSeconds >= 0,
  };
}
