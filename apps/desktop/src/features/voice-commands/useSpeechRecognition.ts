import { useCallback, useMemo, useRef } from "react";

type SpeechResultHandler = (payload: {
  primaryText: string;
  alternatives: string[];
  /** Confianza promedio 0–1 del mejor resultado (si el API la expone) */
  avgConfidence: number;
  /** true si la confianza fue baja, el caller puede decidir pedir reintento */
  isNoisy: boolean;
}) => void;

type SpeechErrorHandler = (error: string) => void;
type SpeechEndHandler = () => void;

export interface SpeechRecognitionOptions {
  /**
   * Confianza mínima (0–1) para aceptar un resultado.
   * Con ruido de ventilador se recomienda 0.25–0.4.
   * Default: 0.3
   */
  minConfidence?: number;
  /**
   * Milisegundos de silencio útil antes de detener automáticamente.
   * Evita que el recognizer se quede escuchando ruido indefinidamente.
   * Default: 4000
   */
  silenceTimeoutMs?: number;
  /**
   * Idiomas a intentar en orden. El primero que el navegador acepte se usará.
   * Default: ["es-ES", "es-MX", "es-419", "en-US"]
   */
  languages?: string[];
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<{
    isFinal?: boolean;
    length?: number;
    [index: number]: { transcript: string; confidence?: number } | undefined;
  }>;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

const DEFAULT_MAX_ALTERNATIVES = 8;
const DEFAULT_MIN_CONFIDENCE = 0.3;
const DEFAULT_SILENCE_TIMEOUT_MS = 4_000;
const DEFAULT_LANGUAGES = ["es-ES", "es-MX", "es-419", "en-US"];
/** Longitud mínima de transcript para no descartarlo como ruido */
const MIN_TRANSCRIPT_CHARS = 2;

function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Construye alternativas rankeadas del evento STT, con filtrado por confianza.
 * Retorna también la confianza promedio de los resultados finales.
 */
function buildUtteranceAlternatives(
  event: SpeechRecognitionEventLike,
  minConfidence: number
): { alternatives: string[]; avgConfidence: number } {
  type AltEntry = { transcript: string; confidence: number };
  const finalResults: Array<AltEntry[]> = [];
  const confidences: number[] = [];

  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result?.isFinal) continue;

    const altCount = Math.max(result.length ?? 1, 1);
    const alternatives: AltEntry[] = [];

    for (let altIdx = 0; altIdx < altCount; altIdx += 1) {
      const alt = result[altIdx];
      const transcript = cleanTranscript(alt?.transcript ?? "");
      if (!transcript || transcript.length < MIN_TRANSCRIPT_CHARS) continue;

      const confidence = typeof alt?.confidence === "number" ? alt.confidence : 1;

      if (confidence < minConfidence && altIdx === 0) {
        alternatives.push({ transcript, confidence });
      } else if (confidence >= minConfidence) {
        alternatives.push({ transcript, confidence });
      }

      if (altIdx === 0) confidences.push(confidence);
    }

    if (alternatives.length > 0) {
      alternatives.sort((a, b) => b.confidence - a.confidence);
      finalResults.push(alternatives);
    }
  }

  if (finalResults.length === 0) {
    return { alternatives: [], avgConfidence: 0 };
  }

  const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1;

  const ranked = new Set<string>();

  const primary = cleanTranscript(finalResults.map((alts) => alts[0]?.transcript ?? "").join(" "));
  if (primary) ranked.add(primary);

  for (let segIdx = 0; segIdx < finalResults.length; segIdx += 1) {
    const segAlts = finalResults[segIdx];
    for (let altIdx = 1; altIdx < segAlts.length; altIdx += 1) {
      const candidate = cleanTranscript(
        finalResults
          .map((alts, idx) => (idx === segIdx ? segAlts[altIdx]?.transcript : alts[0]?.transcript) ?? "")
          .join(" ")
      );
      if (candidate && candidate.length >= MIN_TRANSCRIPT_CHARS) {
        ranked.add(candidate);
      }
      if (ranked.size >= DEFAULT_MAX_ALTERNATIVES) break;
    }
    if (ranked.size >= DEFAULT_MAX_ALTERNATIVES) break;
  }

  return { alternatives: Array.from(ranked), avgConfidence };
}

export function useSpeechRecognition(options: SpeechRecognitionOptions = {}) {
  const {
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
    languages = DEFAULT_LANGUAGES,
  } = options;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResultTimeRef = useRef<number>(0);

  const speechWindow = window as SpeechWindow;
  const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  const isSupported = useMemo(() => Boolean(RecognitionCtor), [RecognitionCtor]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearSilenceTimer();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, [clearSilenceTimer]);

  /**
   * Resetea el timer de silencio. Si no llegan resultados útiles en
   * `silenceTimeoutMs`, detiene el recognizer automáticamente para
   * no seguir capturando ruido de fondo.
   */
  const resetSilenceTimer = useCallback(
    (onTimeout: () => void) => {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        onTimeout();
      }, silenceTimeoutMs);
    },
    [clearSilenceTimer, silenceTimeoutMs]
  );

  const start = useCallback(
    (onResult: SpeechResultHandler, onError: SpeechErrorHandler, onEnd: SpeechEndHandler): boolean => {
      if (!RecognitionCtor) {
        onError("speech_not_supported");
        return false;
      }

      stop();

      const recognition = new RecognitionCtor();

      recognition.lang = languages[0] ?? "es-ES";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = DEFAULT_MAX_ALTERNATIVES;

      recognition.onresult = (event) => {
        const { alternatives, avgConfidence } = buildUtteranceAlternatives(event, minConfidence);

        const primaryText = alternatives[0] ?? "";

        resetSilenceTimer(() => {
          recognitionRef.current?.stop();
        });

        if (!primaryText) return;

        lastResultTimeRef.current = Date.now();

        const isNoisy = avgConfidence < minConfidence + 0.15;

        onResult({
          primaryText,
          alternatives,
          avgConfidence,
          isNoisy,
        });
      };

      recognition.onerror = (event) => {
        clearSilenceTimer();
        const error = event.error ?? "speech_error";
        if (error === "no-speech" || error === "audio-capture") {
          onEnd();
          return;
        }
        onError(error);
      };

      recognition.onend = () => {
        clearSilenceTimer();
        onEnd();
      };

      recognitionRef.current = recognition;

      resetSilenceTimer(() => {
        recognitionRef.current?.stop();
      });

      recognition.start();
      return true;
    },
    [RecognitionCtor, languages, minConfidence, resetSilenceTimer, stop]
  );

  return { isSupported, start, stop };
}
