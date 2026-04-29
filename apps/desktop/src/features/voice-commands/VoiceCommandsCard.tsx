import { Button, Card, CardBody, Chip, Select, SelectItem } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Mic } from "lucide-react";
import { toastError, toastInfo } from "@utils/toast";
import { useSpeechRecognition } from "@/features/voice-commands/useSpeechRecognition";
import { type NoiseSensitivity, useVoiceStore } from "@/features/voice-commands/voiceStore";

const NOISE_LEVEL_OPTIONS: Array<{ key: NoiseSensitivity; label: string; description: string }> = [
  { key: "low", label: "Baja", description: "Entorno silencioso, máxima precisión." },
  { key: "medium", label: "Media", description: "Balance entre precisión y tolerancia al ruido." },
  { key: "high", label: "Alta", description: "Para ruido de fondo constante (ventilador, calle, etc.)." },
];

function formatConfidence(value: number | null): string {
  if (value == null) return "Sin datos";
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `${pct}%`;
}

export function VoiceCommandsCard() {
  const speech = useSpeechRecognition();
  const noiseSensitivity = useVoiceStore((s) => s.noiseSensitivity);
  const setNoiseSensitivity = useVoiceStore((s) => s.setNoiseSensitivity);
  const lastAvgConfidence = useVoiceStore((s) => s.lastAvgConfidence);
  const isNoisy = useVoiceStore((s) => s.isNoisy);

  const handleTestWakeWord = async () => {
    try {
      await invoke("emit_test_wake_word");
      toastInfo("Evento de prueba emitido", "Si no cambia a 'Escuchando comando', el listener frontend falló.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastError("Falló prueba de wake word", message);
    }
  };

  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex items-start gap-3">
          <Mic size={20} className="mt-0.5 shrink-0 text-default-500" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Comandos de voz</h2>
            <p className="mt-0.5 text-sm text-default-500">
              Mantén presionada la tecla <kbd className="rounded bg-default-100 px-1 py-0.5 text-xs">V</kbd> y di “abre
              &lt;juego&gt;”.
            </p>
          </div>
        </div>

        {!speech.isSupported && (
          <div className="rounded-xl border border-warning-200 bg-warning-50/60 p-3 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p className="text-sm">
                Tu sistema no soporta reconocimiento de voz nativo en Web Speech API. La wake word funciona, pero no se
                podrán procesar comandos de voz.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 rounded-xl border border-default-200 bg-default-50/40 p-3 dark:border-default-100/10 dark:bg-default-100/5 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-default-500">Sensibilidad al ruido</p>
            <Select
              aria-label="Sensibilidad al ruido para comandos de voz"
              size="sm"
              selectedKeys={[noiseSensitivity]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected === "low" || selected === "medium" || selected === "high") {
                  setNoiseSensitivity(selected);
                }
              }}>
              {NOISE_LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.key} description={option.description}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-default-500">Estado de reconocimiento</p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="flat" color={isNoisy ? "warning" : "success"}>
                {isNoisy ? "Ruido detectado" : "Señal estable"}
              </Chip>
              <Chip size="sm" variant="flat">
                Calidad: {formatConfidence(lastAvgConfidence)}
              </Chip>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="flat" onPress={handleTestWakeWord}>
            Probar wake word
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
