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

const MAX_UTTERANCE_ALTERNATIVES = 8;

function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildUtteranceAlternatives(event: SpeechRecognitionEventLike): string[] {
  const finalResults: Array<Array<{ transcript: string }>> = [];

  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result?.isFinal) continue;
    const altCount = Math.max(result.length ?? 1, 1);
    const alternatives: Array<{ transcript: string }> = [];
    for (let altIdx = 0; altIdx < altCount; altIdx += 1) {
      const transcript = cleanTranscript(result[altIdx]?.transcript ?? "");
      if (!transcript) continue;
      alternatives.push({ transcript });
    }
    if (alternatives.length > 0) {
      finalResults.push(alternatives);
    }
  }

  if (finalResults.length === 0) {
    return [];
  }

  const ranked = new Set<string>();
  const primary = cleanTranscript(finalResults.map((alts) => alts[0]?.transcript ?? "").join(" "));
  if (primary) ranked.add(primary);

  for (let segmentIdx = 0; segmentIdx < finalResults.length; segmentIdx += 1) {
    const segmentAlternatives = finalResults[segmentIdx];
    for (let altIdx = 1; altIdx < segmentAlternatives.length; altIdx += 1) {
      const candidate = cleanTranscript(
        finalResults
          .map(
            (alts, idx) => (idx === segmentIdx ? segmentAlternatives[altIdx]?.transcript : alts[0]?.transcript) ?? ""
          )
          .join(" ")
      );
      if (candidate) ranked.add(candidate);
      if (ranked.size >= MAX_UTTERANCE_ALTERNATIVES) {
        return Array.from(ranked);
      }
    }
  }

  return Array.from(ranked);
}

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
        const rankedAlternatives = buildUtteranceAlternatives(event);
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
