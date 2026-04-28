import { Card, CardBody } from "@heroui/react";
import { AlertCircle, Loader2, Mic } from "lucide-react";
import { useVoiceStore } from "@/features/voice-commands/voiceStore";

const STATUS_TEXT: Record<string, string> = {
  listeningWake: 'Esperando "Oye Cloud"',
  listeningCommand: "Escuchando comando",
  executing: "Ejecutando comando",
  error: "Error de voz",
};

export function VoiceCommandIndicator() {
  const enabled = useVoiceStore((s) => s.enabled);
  const status = useVoiceStore((s) => s.status);
  const errorMessage = useVoiceStore((s) => s.errorMessage);

  if (!enabled || status === "idle") return null;

  const isExecuting = status === "executing";
  const isError = status === "error";
  const isListeningCommand = status === "listeningCommand";
  const dotClass = isError
    ? "bg-danger-500"
    : isListeningCommand
      ? "bg-success-500 animate-pulse"
      : "bg-default-500 animate-pulse";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40">
      <Card className="border border-default-200/80 bg-background/95 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)]">
        <CardBody className="min-w-[220px] gap-2 p-3">
          <div className="flex items-center gap-2">
            {isExecuting ? (
              <Loader2 size={16} className="animate-spin text-primary-500" />
            ) : isError ? (
              <AlertCircle size={16} className="text-danger-500" />
            ) : (
              <Mic size={16} className="text-default-500" />
            )}
            <span className="text-sm font-medium text-foreground">{STATUS_TEXT[status] ?? "Comandos de voz"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} />
            <span className="text-xs text-default-500">
              {isError ? errorMessage || "Reintenta activar comandos de voz." : "MVP activo"}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
