import { AlertCircle, Loader2, Mic } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import BorderGlow from "@components/external/BorderGlow";
import { useVoiceStore } from "@/features/voice-commands/voiceStore";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";

export function VoiceCommandIndicator() {
  const { t } = useTranslation();
  const enabled = useVoiceStore((s) => s.enabled);
  const status = useVoiceStore((s) => s.status);
  const holdKeyPressed = useVoiceStore((s) => s.holdKeyPressed);
  const errorMessage = useVoiceStore((s) => s.errorMessage);

  const statusKeyMap: Record<string, string> = useMemo(
    () => ({
      listeningWake: "voiceCommands.indicator.statusListeningWake",
      listeningCommand: "voiceCommands.indicator.statusListeningCommand",
      executing: "voiceCommands.indicator.statusExecuting",
      error: "voiceCommands.indicator.statusError",
    }),
    []
  );

  if (!enabled || status === "idle") return null;

  const isExecuting = status === "executing";
  const isError = status === "error";
  const isListeningCommand = status === "listeningCommand";
  const dotClass = isError
    ? "bg-danger-500"
    : isListeningCommand
      ? "bg-success-500 animate-pulse"
      : "bg-default-500 animate-pulse";

  const statusText = statusKeyMap[status] ? t(statusKeyMap[status]) : t("voiceCommands.indicator.defaultTitle");

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40">
      <AnimatePresence>
        {holdKeyPressed && (
          <motion.div
            key="voice-command-indicator"
            initial={{ opacity: 0, y: 16, scale: 0.96, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 12, scale: 0.98, filter: "blur(3px)" }}
            transition={{ type: "spring", stiffness: 260, damping: 24, mass: 0.9 }}>
            <BorderGlow
              active={holdKeyPressed}
              className="min-w-[220px] border-default-200/80 bg-background/95 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)]"
              borderRadius={16}
              edgeSensitivity={0}
              colors={["#7C3AED", "#8B5CF6", "#A78BFA"]}
              fillOpacity={0}
              glowIntensity={0}>
              <div className="gap-2 p-3">
                <div className="flex items-center gap-2">
                  {isExecuting ? (
                    <Loader2 size={16} className="animate-spin text-primary-500" />
                  ) : isError ? (
                    <AlertCircle size={16} className="text-danger-500" />
                  ) : (
                    <Mic size={16} className="text-default-500" />
                  )}
                  <span className="text-sm font-medium text-foreground">{statusText}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                  <span className="text-xs text-default-500">
                    {isError
                      ? errorMessage || t("voiceCommands.indicator.errorHint")
                      : t("voiceCommands.indicator.active")}
                  </span>
                </div>
              </div>
            </BorderGlow>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
