import { create } from "zustand";
import type { StreamingDryRunMetrics } from "@services/tauri";

interface StreamingMetricsState {
  currentMetrics: StreamingDryRunMetrics | null;
  isModalOpen: boolean;
  history: StreamingDryRunMetrics[];
  openMetricsModal: (metrics: StreamingDryRunMetrics) => void;
  closeMetricsModal: () => void;
  clearMetrics: () => void;
  clearHistory: () => void;
}

const MAX_HISTORY_ITEMS = 20;

export const useStreamingMetricsStore = create<StreamingMetricsState>((set) => ({
  currentMetrics: null,
  isModalOpen: false,
  history: [],

  openMetricsModal: (metrics: StreamingDryRunMetrics) => {
    const stampedMetrics: StreamingDryRunMetrics = {
      ...metrics,
      timestamp: metrics.timestamp ?? Date.now(),
    };

    set((state) => ({
      currentMetrics: stampedMetrics,
      isModalOpen: true,
      history: [stampedMetrics, ...state.history.filter((h) => h.filename !== stampedMetrics.filename)].slice(
        0,
        MAX_HISTORY_ITEMS
      ),
    }));
  },

  closeMetricsModal: () => {
    set({ isModalOpen: false });
  },

  clearMetrics: () => {
    set({ currentMetrics: null, isModalOpen: false });
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));
