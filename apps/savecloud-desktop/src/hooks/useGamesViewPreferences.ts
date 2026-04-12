/**
 * useGamesViewPreferences
 * Persiste en localStorage las preferencias de visualización de la lista de juegos:
 *  - layout: "grid-lg" | "grid-md" | "list"
 *  - sortBy: campo de ordenación
 *  - sortDir: "asc" | "desc"
 */

import { useState, useCallback } from "react";

export type GamesLayout = "grid-lg" | "grid-md" | "list";
export type GamesSortField = "title" | "lastModified" | "playtime" | "size";
export type GamesSortDir = "asc" | "desc";

export interface GamesViewPreferences {
  layout: GamesLayout;
  sortBy: GamesSortField;
  sortDir: GamesSortDir;
}

const STORAGE_KEY = "savecloud:games-view-prefs";

const DEFAULTS: GamesViewPreferences = {
  layout: "grid-md",
  sortBy: "title",
  sortDir: "asc",
};

function readFromStorage(): GamesViewPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GamesViewPreferences>;
    return {
      layout: (["grid-lg", "grid-md", "list"] as GamesLayout[]).includes(parsed.layout as GamesLayout)
        ? (parsed.layout as GamesLayout)
        : DEFAULTS.layout,
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // silencioso si localStorage no está disponible
  }
}

export function useGamesViewPreferences() {
  const [prefs, setPrefs] = useState<GamesViewPreferences>(readFromStorage);

  const setLayout = useCallback((layout: GamesLayout) => {
    setPrefs((prev) => {
      const next = { ...prev, layout };
      writeToStorage(next);
      return next;
    });
  }, []);

  const setSortBy = useCallback((sortBy: GamesSortField) => {
    setPrefs((prev) => {
      const next = { ...prev, sortBy };
      writeToStorage(next);
      return next;
    });
  }, []);

  const setSortDir = useCallback((sortDir: GamesSortDir) => {
    setPrefs((prev) => {
      const next = { ...prev, sortDir };
      writeToStorage(next);
      return next;
    });
  }, []);

  /** Alterna la dirección de ordenación. Si cambia el campo, resetea a "asc". */
  const toggleSort = useCallback((field: GamesSortField) => {
    setPrefs((prev) => {
      const next: GamesViewPreferences =
        prev.sortBy === field
          ? { ...prev, sortDir: prev.sortDir === "asc" ? "desc" : "asc" }
          : { ...prev, sortBy: field, sortDir: "asc" };
      writeToStorage(next);
      return next;
    });
  }, []);

  return {
    layout: prefs.layout,
    sortBy: prefs.sortBy,
    sortDir: prefs.sortDir,
    setLayout,
    setSortBy,
    setSortDir,
    toggleSort,
  };
}
