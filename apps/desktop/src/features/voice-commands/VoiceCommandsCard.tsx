import { Button, Card, CardBody, Chip, Select, SelectItem } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Mic } from "lucide-react";
import { toastError, toastInfo } from "@utils/toast";
import { useSpeechRecognition } from "@/features/voice-commands/useSpeechRecognition";
import { type NoiseSensitivity, useVoiceStore } from "@/features/voice-commands/voiceStore";
import { useTranslation, Trans } from "react-i18next";
import { useMemo } from "react";

export function VoiceCommandsCard() {
  const { t } = useTranslation();
  const speech = useSpeechRecognition();
  const noiseSensitivity = useVoiceStore((s) => s.noiseSensitivity);
  const setNoiseSensitivity = useVoiceStore((s) => s.setNoiseSensitivity);
  const lastAvgConfidence = useVoiceStore((s) => s.lastAvgConfidence);
  const isNoisy = useVoiceStore((s) => s.isNoisy);

  const noiseLevelOptions = useMemo(
    () => [
      {
        key: "low" as NoiseSensitivity,
        label: t("voiceCommands.card.noiseSensitivityLow"),
        description: t("voiceCommands.card.noiseSensitivityLowDesc"),
      },
      {
        key: "medium" as NoiseSensitivity,
        label: t("voiceCommands.card.noiseSensitivityMedium"),
        description: t("voiceCommands.card.noiseSensitivityMediumDesc"),
      },
      {
        key: "high" as NoiseSensitivity,
        label: t("voiceCommands.card.noiseSensitivityHigh"),
        description: t("voiceCommands.card.noiseSensitivityHighDesc"),
      },
    ],
    [t]
  );

  const formatConfidence = (value: number | null): string => {
    if (value == null) return t("voiceCommands.card.noData");
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    return `${pct}%`;
  };

  const handleTestWakeWord = async () => {
    try {
      await invoke("emit_test_wake_word");
      toastInfo(t("voiceCommands.card.testWakeWordSuccess"), t("voiceCommands.card.testWakeWordSuccessDesc"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastError(t("voiceCommands.card.testWakeWordError"), message);
    }
  };

  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex items-start gap-3">
          <Mic size={20} className="mt-0.5 shrink-0 text-default-500" />
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("voiceCommands.card.title")}</h2>
            <p className="mt-0.5 text-sm text-default-500">
              <Trans i18nKey="voiceCommands.card.subtitle">
                Mantén presionada la tecla <kbd className="rounded bg-default-100 px-1 py-0.5 text-xs">V</kbd> y di
                “abre &lt;juego&gt;”.
              </Trans>
            </p>
          </div>
        </div>

        {!speech.isSupported && (
          <div className="rounded-xl border border-warning-200 bg-warning-50/60 p-3 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p className="text-sm">{t("voiceCommands.card.unsupportedWarning")}</p>
            </div>
          </div>
        )}

        <div className="grid gap-3 rounded-xl border border-default-200 bg-default-50/40 p-3 dark:border-default-100/10 dark:bg-default-100/5 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-default-500">
              {t("voiceCommands.card.noiseSensitivity")}
            </p>
            <Select
              aria-label={t("voiceCommands.card.noiseSensitivityAria")}
              size="sm"
              selectedKeys={[noiseSensitivity]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected === "low" || selected === "medium" || selected === "high") {
                  setNoiseSensitivity(selected);
                }
              }}>
              {noiseLevelOptions.map((option) => (
                <SelectItem key={option.key} description={option.description}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-default-500">
              {t("voiceCommands.card.recognitionState")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="flat" color={isNoisy ? "warning" : "success"}>
                {isNoisy ? t("voiceCommands.card.noiseDetected") : t("voiceCommands.card.signalStable")}
              </Chip>
              <Chip size="sm" variant="flat">
                {t("voiceCommands.card.quality", { confidence: formatConfidence(lastAvgConfidence) })}
              </Chip>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="flat" onPress={handleTestWakeWord}>
            {t("voiceCommands.card.testWakeWord")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
