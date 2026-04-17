import { create } from "zustand";
import type { SaveGraphFiltersState } from "@app-types/saveGraph";

const DEFAULT_WINDOW_DAYS = 90;

interface SaveGraphUiState {
  selectedNodeId: string | null;
  filters: SaveGraphFiltersState;
  setSelectedNodeId: (nodeId: string | null) => void;
  setWindowDays: (days: number) => void;
  reset: () => void;
}

/**
 * Estado visual efimero de los grafos de guardados.
 */
export const useSaveGraphStore = create<SaveGraphUiState>((set) => ({
  selectedNodeId: null,
  filters: {
    windowDays: DEFAULT_WINDOW_DAYS,
  },
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setWindowDays: (windowDays) =>
    set((state) => ({
      filters: {
        ...state.filters,
        windowDays,
      },
    })),
  reset: () =>
    set({
      selectedNodeId: null,
      filters: {
        windowDays: DEFAULT_WINDOW_DAYS,
      },
    }),
}));
