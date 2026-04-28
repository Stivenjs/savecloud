import { create } from "zustand";

export type VoiceStatus = "idle" | "listeningWake" | "listeningCommand" | "executing" | "error";

interface VoiceStoreState {
  enabled: boolean;
  status: VoiceStatus;
  lastTranscript: string | null;
  errorMessage: string | null;
  setEnabled: (value: boolean) => void;
  setStatus: (status: VoiceStatus) => void;
  setTranscript: (text: string | null) => void;
  setError: (message: string | null) => void;
}

const STORAGE_KEY = "voice-commands:v1";

const getInitialEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
};

const persistEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // noop
  }
};

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  enabled: getInitialEnabled(),
  status: "idle",
  lastTranscript: null,
  errorMessage: null,
  setEnabled: (value) =>
    set(() => {
      persistEnabled(value);
      return { enabled: value, status: value ? "listeningWake" : "idle", errorMessage: null };
    }),
  setStatus: (status) => set(() => ({ status })),
  setTranscript: (text) => set(() => ({ lastTranscript: text })),
  setError: (message) => set(() => ({ errorMessage: message, status: message ? "error" : "idle" })),
}));
