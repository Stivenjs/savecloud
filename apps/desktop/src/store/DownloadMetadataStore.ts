import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface DownloadMetadata {
  gameId?: string;
  gameName?: string;
  steamAppId?: string;
  imageUrl?: string;
}

interface DownloadMetadataStore {
  metadataByKey: Record<string, DownloadMetadata>;
  setMetadata: (key: string, meta: DownloadMetadata) => void;
  getMetadata: (key: string) => DownloadMetadata | undefined;
  removeMetadata: (key: string) => void;
  cleanOldMetadata: (activeKeys: string[]) => void;
}

export const useDownloadMetadataStore = create<DownloadMetadataStore>()(
  persist(
    (set, get) => ({
      metadataByKey: {},
      setMetadata: (key, meta) => {
        if (!key?.trim()) return;
        set((state) => ({
          metadataByKey: {
            ...state.metadataByKey,
            [key.trim()]: { ...state.metadataByKey[key.trim()], ...meta },
          },
        }));
      },
      getMetadata: (key) => {
        if (!key?.trim()) return undefined;
        return get().metadataByKey[key.trim()];
      },
      removeMetadata: (key) => {
        if (!key?.trim()) return;
        set((state) => {
          const next = { ...state.metadataByKey };
          delete next[key.trim()];
          return { metadataByKey: next };
        });
      },
      cleanOldMetadata: (activeKeys) =>
        set((state) => {
          const activeSet = new Set(activeKeys.map((k) => k.trim()));
          const next: Record<string, DownloadMetadata> = {};
          for (const [k, v] of Object.entries(state.metadataByKey)) {
            if (activeSet.has(k)) {
              next[k] = v;
            }
          }
          return { metadataByKey: next };
        }),
    }),
    {
      name: "savecloud-download-metadata",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
