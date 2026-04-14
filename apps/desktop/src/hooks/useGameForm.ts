import { useCallback, useEffect, useState } from "react";
import type { ConfiguredGame } from "@app-types/config";

export interface GameFormState {
  gameId: string;
  path: string;
  editionLabel: string;
  sourceUrl: string;
  searchInput: string;
  selectedSteamAppId: string | null;
  imageUrl: string;
  magnetLink: string;
  /** Ruta absoluta al .exe para lanzar el juego desde la ficha (se guarda al pulsar Guardar). */
  launchExecutablePath: string;
  /** Nombres de proceso para detección manual (se guardan al pulsar Guardar). */
  executableNames: string[];
}

export interface UseGameFormReturn {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  resetForm: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const EMPTY_FORM: GameFormState = {
  gameId: "",
  path: "",
  editionLabel: "",
  sourceUrl: "",
  searchInput: "",
  selectedSteamAppId: null,
  imageUrl: "",
  magnetLink: "",
  launchExecutablePath: "",
  executableNames: [],
};

interface UseGameFormOptions {
  isOpen: boolean;
  mode: "add" | "edit";
  game?: ConfiguredGame | null;
  initialPath?: string;
  suggestedId?: string;
}

function buildFormFromGame(game: ConfiguredGame): GameFormState {
  return {
    gameId: game.id,
    path: (game.paths ?? [])[0] ?? "",
    editionLabel: game.editionLabel ?? "",
    sourceUrl: game.sourceUrl ?? "",
    searchInput: "",
    selectedSteamAppId: game.steamAppId ?? null,
    imageUrl: game.imageUrl ?? "",
    magnetLink: game.magnetLink ?? "",
    launchExecutablePath: game.launchExecutablePath ?? "",
    executableNames: game.executableNames?.length ? [...game.executableNames] : [],
  };
}

export function useGameForm({
  isOpen,
  mode,
  game,
  initialPath = "",
  suggestedId = "",
}: UseGameFormOptions): UseGameFormReturn {
  const [form, setForm] = useState<GameFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const gameId = game?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;

    if (mode === "edit" && game) {
      setForm(buildFormFromGame(game));
    } else {
      setForm({
        ...EMPTY_FORM,
        gameId: suggestedId,
        path: initialPath,
      });
    }

    setError(null);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, gameId, initialPath, suggestedId]);

  const setField = useCallback(<K extends keyof GameFormState>(key: K, value: GameFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setError(null);
    setLoading(false);
  }, []);

  return { form, setField, resetForm, error, setError, loading, setLoading };
}
