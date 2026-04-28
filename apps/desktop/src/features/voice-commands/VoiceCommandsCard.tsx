import { Button, Card, CardBody } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Mic } from "lucide-react";
import { toastError, toastInfo } from "@utils/toast";
import { useSpeechRecognition } from "@/features/voice-commands/useSpeechRecognition";

export function VoiceCommandsCard() {
  const speech = useSpeechRecognition();

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

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="flat" onPress={handleTestWakeWord}>
            Probar wake word
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
