import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toastError, toastInfo, toastSuccess } from "@utils/toast";

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

export function useVoiceCommands() {
  const enabled = useVoiceStore((s) => s.enabled);
  const setEnabled = useVoiceStore((s) => s.setEnabled);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setError = useVoiceStore((s) => s.setError);
  const speech = useSpeechRecognition();
  const { start, stop } = speech;
  const commandInFlightRef = useRef(false);
  const wakeDebounceUntilRef = useRef(0);
  const commandCooldownUntilRef = useRef(0);
  const holdTriggerActiveRef = useRef(false);
  const speechSessionActiveRef = useRef(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const beginCommandListening = (showWakeToast: boolean) => {
      if (speechSessionActiveRef.current || commandInFlightRef.current) {
        return;
      }
      const started = start(
        async (text) => {
          const nowCommand = Date.now();
          if (commandInFlightRef.current || nowCommand < commandCooldownUntilRef.current) {
            return;
          }
          commandInFlightRef.current = true;
          commandCooldownUntilRef.current = nowCommand + 4_000;
          setTranscript(text);
          const { target } = parseVoiceCommand(text);
          if (!target) {
            toastInfo("No te escuché bien", "Prueba de nuevo: abre Counter Strike.");
            setStatus("listeningWake");
            stop();
            commandInFlightRef.current = false;
            speechSessionActiveRef.current = false;
            return;
          }

          setStatus("executing");

          try {
            const match = await invoke<GameMatch | null>("find_game_by_voice_query", { text: target });
            if (!match) {
              toastInfo("Juego no encontrado", `No encuentro "${target}" en tu librería.`);
              setStatus("listeningWake");
              return;
            }
            await invoke("launch_game", { gameId: match.game_id });
            toastSuccess("Abriendo juego", match.name);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastError("No se pudo ejecutar el comando de voz", message);
          } finally {
            stop();
            commandInFlightRef.current = false;
            speechSessionActiveRef.current = false;
            setStatus("listeningWake");
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
          setStatus("listeningWake");
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
        toastInfo("Wake word detectada", "Di el comando ahora (por ejemplo: abre Minecraft).");
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
      beginCommandListening(false);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== VOICE_HOLD_KEY && event.key.toLowerCase() !== "v") return;
      event.preventDefault();
      event.stopPropagation();
      holdTriggerActiveRef.current = false;
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        if (!holdTriggerActiveRef.current && speechSessionActiveRef.current && !commandInFlightRef.current) {
          stop();
          speechSessionActiveRef.current = false;
          setStatus("listeningWake");
        }
      }, RELEASE_GRACE_MS);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);

    return () => {
      stop();
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [enabled, setError, setStatus, setTranscript, start, stop]);
}
