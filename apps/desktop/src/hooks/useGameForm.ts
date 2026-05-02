import { useCallback, useEffect, useState, useMemo } from "react";
import type { ConfiguredGame } from "@app-types/config";
import { formatGameDisplayName } from "@utils/gameImage";
import { dedupePreserveGamePaths } from "@utils/gameSavePaths";

export interface GameFormState {
  gameId: string;
  /** Carpetas/archivos raíz de guardado (varias ubicaciones por juego). */
  paths: string[];
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

/** Misma referencia para “sin rutas precargadas”; evita bucles en useEffect (nunca usar `= []` como default). */
export const STABLE_EMPTY_GAME_PATHS: string[] = [];

export interface UseGameFormReturn {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  resetForm: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  isDirty: boolean;
}

const EMPTY_FORM: GameFormState = {
  gameId: "",
  paths: [],
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
  initialPaths?: string[];
  suggestedId?: string;
}

function buildFormFromGame(game: ConfiguredGame): GameFormState {
  return {
    gameId: formatGameDisplayName(game.id),
    paths: game.paths?.length ? dedupePreserveGamePaths([...game.paths]) : [],
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
  initialPaths = STABLE_EMPTY_GAME_PATHS,
  suggestedId = "",
}: UseGameFormOptions): UseGameFormReturn {
  const [form, setForm] = useState<GameFormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<GameFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const gameId = game?.id ?? null;

  useEffect(() => {
    if (!isOpen) return;

    let initForm: GameFormState;
    if (mode === "edit" && game) {
      initForm = buildFormFromGame(game);
    } else {
      initForm = {
        ...EMPTY_FORM,
        gameId: suggestedId,
        paths: dedupePreserveGamePaths(initialPaths),
      };
    }

    setForm(initForm);
    setInitialForm(initForm);

    setError(null);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, gameId, initialPaths, suggestedId]);

  const setField = useCallback(<K extends keyof GameFormState>(key: K, value: GameFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setForm(initialForm || EMPTY_FORM);
    setError(null);
    setLoading(false);
  }, [initialForm]);

  const isDirty = useMemo(() => {
    if (mode === "add") return true;
    if (!initialForm) return false;
    return JSON.stringify(form) !== JSON.stringify(initialForm);
  }, [form, initialForm, mode]);

  return { form, setField, resetForm, error, setError, loading, setLoading, isDirty };
}
