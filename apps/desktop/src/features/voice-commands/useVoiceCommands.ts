import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toastError, toastInfo, toastSuccess } from "@utils/toast";
import { formatGameDisplayName } from "@utils/gameImage";
import { parseVoiceCommand } from "@/features/voice-commands/commandMapper";
import { useSpeechRecognition } from "@/features/voice-commands/useSpeechRecognition";
import { useVoiceStore } from "@/features/voice-commands/voiceStore";

interface GameMatch {
  game_id: string;
  name: string;
  score: number;
}

const WAKE_WORD_EVENT = "voice://wake-word-detected";
const VOICE_HOLD_KEY = "KeyV";
const RELEASE_GRACE_MS = 180;
const VOICE_CORRECTIONS_STORAGE_KEY = "voice-commands:learned-corrections:v1";

type LearnedCorrection = {
  gameId: string;
  gameName: string;
};

function normalizeTargetText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildVoiceTargets(alternatives: string[]): string[] {
  const out = new Set<string>();
  for (const text of alternatives) {
    const target = parseVoiceCommand(text).target.trim();
    if (!target) continue;
    const normalized = normalizeTargetText(target);
    if (!normalized) continue;
    out.add(normalized);
    const compact = normalized.replace(/\s+/g, "");
    if (compact.length >= 4 && compact !== normalized) {
      out.add(compact);
    }
  }
  return Array.from(out);
}

function normalizeVoiceKey(text: string): string {
  return normalizeTargetText(text).replace(/\s+/g, " ");
}

function loadLearnedCorrections(): Record<string, LearnedCorrection> {
  try {
    const raw = localStorage.getItem(VOICE_CORRECTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LearnedCorrection>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLearnedCorrections(corrections: Record<string, LearnedCorrection>): void {
  try {
    localStorage.setItem(VOICE_CORRECTIONS_STORAGE_KEY, JSON.stringify(corrections));
  } catch {
    // noop
  }
}

export function useVoiceCommands() {
  const enabled = useVoiceStore((s) => s.enabled);
  const setEnabled = useVoiceStore((s) => s.setEnabled);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setError = useVoiceStore((s) => s.setError);
  const setHoldKeyPressed = useVoiceStore((s) => s.setHoldKeyPressed);
  const speech = useSpeechRecognition();
  const { start, stop } = speech;
  const commandInFlightRef = useRef(false);
  const wakeDebounceUntilRef = useRef(0);
  const commandCooldownUntilRef = useRef(0);
  const holdTriggerActiveRef = useRef(false);
  const speechSessionActiveRef = useRef(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const learnedCorrectionsRef = useRef<Record<string, LearnedCorrection>>(loadLearnedCorrections());

  useEffect(() => {
    if (!enabled) {
      setEnabled(true);
    }
  }, [enabled, setEnabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    setStatus("listeningWake");
    const syncIdleListeningStatus = () => {
      setStatus(holdTriggerActiveRef.current ? "listeningCommand" : "listeningWake");
    };

    const beginCommandListening = (showWakeToast: boolean) => {
      if (speechSessionActiveRef.current || commandInFlightRef.current) {
        return;
      }
      const started = start(
        async ({ primaryText, alternatives }) => {
          const nowCommand = Date.now();
          if (commandInFlightRef.current || nowCommand < commandCooldownUntilRef.current) {
            return;
          }
          commandInFlightRef.current = true;
          commandCooldownUntilRef.current = nowCommand + 4_000;
          setTranscript(primaryText);
          const targets = buildVoiceTargets(alternatives);
          if (targets.length === 0) {
            toastInfo("No te escuché bien", "Prueba de nuevo: abre Counter Strike.");
            syncIdleListeningStatus();
            stop();
            commandInFlightRef.current = false;
            speechSessionActiveRef.current = false;
            return;
          }

          setStatus("executing");

          try {
            let launched = false;
            let resolvedMatch: GameMatch | null = null;
            let resolvedTarget = "";

            for (const target of targets) {
              const learned = learnedCorrectionsRef.current[normalizeVoiceKey(target)];
              if (learned) {
                try {
                  await invoke("launch_game", { gameId: learned.gameId });
                  toastSuccess("Abriendo juego", formatGameDisplayName(learned.gameId));
                  launched = true;
                  break;
                } catch {
                  delete learnedCorrectionsRef.current[normalizeVoiceKey(target)];
                  saveLearnedCorrections(learnedCorrectionsRef.current);
                }
              }

              const match = await invoke<GameMatch | null>("find_game_by_voice_query", { text: target });
              if (match) {
                resolvedMatch = match;
                resolvedTarget = target;
                break;
              }
            }

            if (launched) {
              return;
            }

            if (!resolvedMatch) {
              const fallbackTarget = targets[0];
              const suggestions = await invoke<GameMatch[]>("find_game_voice_candidates", {
                text: fallbackTarget,
                limit: 3,
              });
              if (suggestions.length > 0) {
                const names = suggestions
                  .slice(0, 2)
                  .map((s) => formatGameDisplayName(s.game_id))
                  .join(" o ");
                toastInfo("Juego no encontrado", `No encontré "${fallbackTarget}". Quizá quisiste decir: ${names}.`);
              } else {
                toastInfo("Juego no encontrado", `No encuentro "${fallbackTarget}" en tu librería.`);
              }
              syncIdleListeningStatus();
              return;
            }

            await invoke("launch_game", { gameId: resolvedMatch.game_id });
            const learnedKey = normalizeVoiceKey(resolvedTarget);
            learnedCorrectionsRef.current[learnedKey] = {
              gameId: resolvedMatch.game_id,
              gameName: formatGameDisplayName(resolvedMatch.game_id),
            };
            saveLearnedCorrections(learnedCorrectionsRef.current);
            toastSuccess("Abriendo juego", formatGameDisplayName(resolvedMatch.game_id));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastError("No se pudo ejecutar el comando de voz", message);
          } finally {
            stop();
            commandInFlightRef.current = false;
            speechSessionActiveRef.current = false;
            syncIdleListeningStatus();
          }
        },
        (speechError) => {
          commandInFlightRef.current = false;
          speechSessionActiveRef.current = false;
          setError(speechError);
          toastError("Error de reconocimiento", speechError);
        },
        () => {
          commandInFlightRef.current = false;
          speechSessionActiveRef.current = false;
          syncIdleListeningStatus();
        }
      );

      if (!started) {
        toastError("Tu sistema no soporta reconocimiento de voz");
        setStatus("error");
        return;
      }

      speechSessionActiveRef.current = true;
      setStatus("listeningCommand");
      if (showWakeToast) {
        toastInfo("Escuchando", "Di solo el nombre del juego o usa 'abre <juego>'.");
      }
    };

    const unlistenPromise = listen<string>(WAKE_WORD_EVENT, async () => {
      const now = Date.now();
      if (now < wakeDebounceUntilRef.current || commandInFlightRef.current) {
        return;
      }
      wakeDebounceUntilRef.current = now + 2_000;
      beginCommandListening(true);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== VOICE_HOLD_KEY && event.key.toLowerCase() !== "v") return;
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();

      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      if (holdTriggerActiveRef.current) return;
      holdTriggerActiveRef.current = true;
      setHoldKeyPressed(true);
      setStatus("listeningCommand");
      beginCommandListening(false);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== VOICE_HOLD_KEY && event.key.toLowerCase() !== "v") return;
      event.preventDefault();
      event.stopPropagation();
      holdTriggerActiveRef.current = false;
      setHoldKeyPressed(false);
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        if (!holdTriggerActiveRef.current && speechSessionActiveRef.current && !commandInFlightRef.current) {
          stop();
          speechSessionActiveRef.current = false;
          syncIdleListeningStatus();
        }
      }, RELEASE_GRACE_MS);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);

    return () => {
      stop();
      setHoldKeyPressed(false);
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [enabled, setError, setHoldKeyPressed, setStatus, setTranscript, start, stop]);
}
