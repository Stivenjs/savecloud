import { useCallback, useMemo, useRef } from "react";

type SpeechResultHandler = (payload: { primaryText: string; alternatives: string[] }) => void;
type SpeechErrorHandler = (error: string) => void;
type SpeechEndHandler = () => void;

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
    [index: number]: { transcript: string } | undefined;
  }>;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

export function useSpeechRecognition() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechWindow = window as SpeechWindow;
  const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  const isSupported = useMemo(() => Boolean(RecognitionCtor), [RecognitionCtor]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const start = useCallback(
    (onResult: SpeechResultHandler, onError: SpeechErrorHandler, onEnd: SpeechEndHandler): boolean => {
      if (!RecognitionCtor) {
        onError("speech_not_supported");
        return false;
      }

      stop();
      const recognition = new RecognitionCtor();
      recognition.lang = "es-ES";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      recognition.onresult = (event) => {
        const startIndex = event.resultIndex ?? 0;
        const alternatives = new Set<string>();
        for (let i = startIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result?.isFinal) continue;
          const altCount = result.length ?? 1;
          for (let altIdx = 0; altIdx < altCount; altIdx += 1) {
            const transcript = result[altIdx]?.transcript?.trim();
            if (transcript) alternatives.add(transcript);
          }
        }
        const rankedAlternatives = Array.from(alternatives);
        const primaryText = rankedAlternatives[0] ?? "";
        if (primaryText) onResult({ primaryText, alternatives: rankedAlternatives });
      };
      recognition.onerror = (event) => onError(event.error || "speech_error");
      recognition.onend = onEnd;
      recognitionRef.current = recognition;
      recognition.start();
      return true;
    },
    [RecognitionCtor, stop]
  );

  return { isSupported, start, stop };
}
