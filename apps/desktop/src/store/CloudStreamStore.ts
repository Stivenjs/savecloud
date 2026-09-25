import { create } from "zustand";

export interface CloudStreamSession {
  streamId: string;
  hostUserId: string;
  startedAt: number;
  qualityPreset: string;
  hasSystemAudio: boolean;
  hasMicAudio: boolean;
  viewerCount: number;
  maxViewers: number;
}

interface CloudStreamStore {
  streams: CloudStreamSession[];
  activeHostedStreamId: string | null;
  upsertStream: (stream: CloudStreamSession) => void;
  setViewerCount: (streamId: string, viewerCount: number) => void;
  setActiveHostedStreamId: (streamId: string | null) => void;
  removeStream: (streamId: string) => void;
  clearStreams: () => void;
}

export const useCloudStreamStore = create<CloudStreamStore>((set) => ({
  streams: [],
  activeHostedStreamId: null,
  upsertStream: (stream) =>
    set((state) => {
      const idx = state.streams.findIndex((item) => item.streamId === stream.streamId);
      if (idx < 0) {
        return { streams: [stream, ...state.streams] };
      }

      const next = [...state.streams];
      next[idx] = { ...next[idx], ...stream };
      return { streams: next };
    }),
  setViewerCount: (streamId, viewerCount) =>
    set((state) => ({
      streams: state.streams.map((stream) =>
        stream.streamId === streamId
          ? {
              ...stream,
              viewerCount,
            }
          : stream
      ),
    })),
  setActiveHostedStreamId: (streamId) => set({ activeHostedStreamId: streamId }),
  removeStream: (streamId) =>
    set((state) => ({
      streams: state.streams.filter((stream) => stream.streamId !== streamId),
      activeHostedStreamId: state.activeHostedStreamId === streamId ? null : state.activeHostedStreamId,
    })),
  clearStreams: () => set({ streams: [], activeHostedStreamId: null }),
}));
