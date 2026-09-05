import { create } from "zustand";

export type GamesLayout = "grid-lg" | "grid-md" | "list";
export type GamesCardOrientation = "vertical" | "horizontal";
export type GamesSortField = "title" | "lastModified" | "playtime" | "size";
export type GamesSortDir = "asc" | "desc";

export interface GamesViewPreferences {
  layout: GamesLayout;
  cardOrientation: GamesCardOrientation;
  sortBy: GamesSortField;
  sortDir: GamesSortDir;
}

const STORAGE_KEY = "savecloud:games-view-prefs";

const DEFAULTS: GamesViewPreferences = {
  layout: "grid-md",
  cardOrientation: "vertical",
  sortBy: "title",
  sortDir: "asc",
};

function readFromStorage(): GamesViewPreferences {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GamesViewPreferences>;
    return {
      layout: (["grid-lg", "grid-md", "list"] as GamesLayout[]).includes(parsed.layout as GamesLayout)
        ? (parsed.layout as GamesLayout)
        : DEFAULTS.layout,
      cardOrientation: (["vertical", "horizontal"] as GamesCardOrientation[]).includes(
        parsed.cardOrientation as GamesCardOrientation
      )
        ? (parsed.cardOrientation as GamesCardOrientation)
        : DEFAULTS.cardOrientation,
      sortBy: (["title", "lastModified", "playtime", "size"] as GamesSortField[]).includes(
        parsed.sortBy as GamesSortField
      )
        ? (parsed.sortBy as GamesSortField)
        : DEFAULTS.sortBy,
      sortDir: (["asc", "desc"] as GamesSortDir[]).includes(parsed.sortDir as GamesSortDir)
        ? (parsed.sortDir as GamesSortDir)
        : DEFAULTS.sortDir,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeToStorage(prefs: GamesViewPreferences): void {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {}
}

export interface GamesViewPreferencesState extends GamesViewPreferences {
  setLayout: (layout: GamesLayout) => void;
  setCardOrientation: (cardOrientation: GamesCardOrientation) => void;
  setSortBy: (sortBy: GamesSortField) => void;
  setSortDir: (sortDir: GamesSortDir) => void;
  toggleSort: (field: GamesSortField) => void;
}

const initialPrefs = readFromStorage();

export const useGamesViewPreferencesStore = create<GamesViewPreferencesState>((set, get) => ({
  ...initialPrefs,
  setLayout: (layout) => {
    set({ layout });
    writeToStorage({
      layout,
      cardOrientation: get().cardOrientation,
      sortBy: get().sortBy,
      sortDir: get().sortDir,
    });
  },
  setCardOrientation: (cardOrientation) => {
    set({ cardOrientation });
    writeToStorage({
      layout: get().layout,
      cardOrientation,
      sortBy: get().sortBy,
      sortDir: get().sortDir,
    });
  },
  setSortBy: (sortBy) => {
    set({ sortBy });
    writeToStorage({
      layout: get().layout,
      cardOrientation: get().cardOrientation,
      sortBy,
      sortDir: get().sortDir,
    });
  },
  setSortDir: (sortDir) => {
    set({ sortDir });
    writeToStorage({
      layout: get().layout,
      cardOrientation: get().cardOrientation,
      sortBy: get().sortBy,
      sortDir,
    });
  },
  toggleSort: (field) => {
    const current = get();
    const nextSortDir: GamesSortDir = current.sortBy === field ? (current.sortDir === "asc" ? "desc" : "asc") : "asc";
    set({ sortBy: field, sortDir: nextSortDir });
    writeToStorage({
      layout: current.layout,
      cardOrientation: current.cardOrientation,
      sortBy: field,
      sortDir: nextSortDir,
    });
  },
}));

export function initGamesViewPreferences(): () => void {
  if (typeof window === "undefined") return () => {};

  const fresh = readFromStorage();
  useGamesViewPreferencesStore.setState(fresh);

  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const next = JSON.parse(e.newValue) as Partial<GamesViewPreferences>;
        useGamesViewPreferencesStore.setState((prev) => ({
          layout: (["grid-lg", "grid-md", "list"] as GamesLayout[]).includes(next.layout as GamesLayout)
            ? (next.layout as GamesLayout)
            : prev.layout,
          cardOrientation: (["vertical", "horizontal"] as GamesCardOrientation[]).includes(
            next.cardOrientation as GamesCardOrientation
          )
            ? (next.cardOrientation as GamesCardOrientation)
            : prev.cardOrientation,
          sortBy: (["title", "lastModified", "playtime", "size"] as GamesSortField[]).includes(
            next.sortBy as GamesSortField
          )
            ? (next.sortBy as GamesSortField)
            : prev.sortBy,
          sortDir: (["asc", "desc"] as GamesSortDir[]).includes(next.sortDir as GamesSortDir)
            ? (next.sortDir as GamesSortDir)
            : prev.sortDir,
        }));
      } catch {}
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

import { useShallow } from "zustand/react/shallow";

export function useGamesViewPreferences(): GamesViewPreferencesState;
export function useGamesViewPreferences<T>(selector: (state: GamesViewPreferencesState) => T): T;
export function useGamesViewPreferences<T>(
  selector?: (state: GamesViewPreferencesState) => T
): T | GamesViewPreferencesState {
  if (selector) {
    return useGamesViewPreferencesStore(selector);
  }
  return useGamesViewPreferencesStore(
    useShallow((s) => ({
      layout: s.layout,
      cardOrientation: s.cardOrientation,
      sortBy: s.sortBy,
      sortDir: s.sortDir,
      setLayout: s.setLayout,
      setCardOrientation: s.setCardOrientation,
      setSortBy: s.setSortBy,
      setSortDir: s.setSortDir,
      toggleSort: s.toggleSort,
    }))
  );
}

/**
 * Selector atómico de alto rendimiento para componentes que solo necesitan
 * conocer la orientación de las tarjetas (vertical u horizontal).
 * Evita re-renders cuando cambian layout, sortBy o sortDir.
 */
export function useGamesCardOrientation(): GamesCardOrientation {
  return useGamesViewPreferencesStore((s) => s.cardOrientation);
}

/**
 * Selector atómico de alto rendimiento para componentes que solo necesitan
 * conocer el tipo de layout ('grid-lg' | 'grid-md' | 'list').
 */
export function useGamesLayout(): GamesLayout {
  return useGamesViewPreferencesStore((s) => s.layout);
}
