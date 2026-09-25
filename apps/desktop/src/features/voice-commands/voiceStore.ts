import { create } from "zustand";

export type VoiceStatus = "idle" | "listeningWake" | "listeningCommand" | "executing" | "error";

export type NoiseSensitivity = "low" | "medium" | "high";

/** Umbral de confianza mínima por nivel de sensibilidad */
export const NOISE_SENSITIVITY_CONFIDENCE: Record<NoiseSensitivity, number> = {
  low: 0.5, // Entorno silencioso: solo acepta transcripciones muy claras
  medium: 0.3, // Default: balance ruido/precisión
  high: 0.15, // Mucho ruido: acepta resultados más inciertos, confía más en fuzzy matching
};

/** Timeout de silencio por nivel de sensibilidad (ms) */
export const NOISE_SENSITIVITY_SILENCE_MS: Record<NoiseSensitivity, number> = {
  low: 3_000,
  medium: 4_000,
  high: 5_500, // Más tiempo esperando porque con ruido los silencios son más cortos
};

interface VoiceStoreState {
  enabled: boolean;
  status: VoiceStatus;
  holdKeyPressed: boolean;
  lastTranscript: string | null;
  errorMessage: string | null;
  /** Nivel de sensibilidad al ruido de fondo */
  noiseSensitivity: NoiseSensitivity;
  /** Confianza promedio del último resultado STT (0–1) */
  lastAvgConfidence: number | null;
  /** true si el último reconocimiento fue detectado como ruidoso */
  isNoisy: boolean;

  setEnabled: (value: boolean) => void;
  setHoldKeyPressed: (value: boolean) => void;
  setStatus: (status: VoiceStatus) => void;
  setTranscript: (text: string | null) => void;
  setError: (message: string | null) => void;
  setNoiseSensitivity: (level: NoiseSensitivity) => void;
  setLastRecognitionQuality: (avgConfidence: number, isNoisy: boolean) => void;
}

const STORAGE_KEY = "voice-commands:v1";
const SENSITIVITY_STORAGE_KEY = "voice-commands:sensitivity:v1";

const getInitialEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
};

const getInitialSensitivity = (): NoiseSensitivity => {
  try {
    const raw = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    if (raw === "low" || raw === "medium" || raw === "high") return raw;
    return "medium";
  } catch {
    return "medium";
  }
};

const persistEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // noop
  }
};

const persistSensitivity = (level: NoiseSensitivity): void => {
  try {
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, level);
  } catch {
    // noop
  }
};

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  enabled: getInitialEnabled(),
  status: "idle",
  holdKeyPressed: false,
  lastTranscript: null,
  errorMessage: null,
  noiseSensitivity: getInitialSensitivity(),
  lastAvgConfidence: null,
  isNoisy: false,

  setEnabled: (value) =>
    set(() => {
      persistEnabled(value);
      return {
        enabled: value,
        status: value ? "listeningWake" : "idle",
        holdKeyPressed: false,
        errorMessage: null,
        isNoisy: false,
      };
    }),

  setHoldKeyPressed: (value) => set(() => ({ holdKeyPressed: value })),

  setStatus: (status) => set(() => ({ status })),

  setTranscript: (text) => set(() => ({ lastTranscript: text })),

  setError: (message) =>
    set(() => ({
      errorMessage: message,
      status: message ? "error" : "idle",
    })),

  setNoiseSensitivity: (level) =>
    set(() => {
      persistSensitivity(level);
      return { noiseSensitivity: level };
    }),

  setLastRecognitionQuality: (avgConfidence, isNoisy) => set(() => ({ lastAvgConfidence: avgConfidence, isNoisy })),
}));
