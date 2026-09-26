import { Button, Input } from "@heroui/react";
import { setSteamWebApiKey } from "@services/tauri/config.service";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toastError, toastSuccess } from "@utils/toast";

interface SteamApiKeySettingsProps {
  hasApiKey: boolean;
  isLoading: boolean;
}

export function SteamApiKeySettings({ hasApiKey, isLoading }: SteamApiKeySettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!apiKey.trim()) return;

    setSaving(true);
    try {
      await setSteamWebApiKey(apiKey);
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(t("settings.configSection.steamKeySaved"));
    } catch (error) {
      toastError(t("settings.configSection.steamKeySaveError"), error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-default-200/70 bg-default-50/55 p-3 dark:border-default-100/15 dark:bg-default-50/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-default-500">{t("settings.configSection.steamKeyLabel")}</span>
        {!isLoading ? (
          <span className={hasApiKey ? "text-xs font-medium text-success-600" : "text-xs text-default-400"}>
            {t(hasApiKey ? "settings.configSection.steamKeyConfigured" : "settings.configSection.steamKeyMissing")}
          </span>
        ) : null}
      </div>
      <Input
        aria-label={t("settings.configSection.steamKeyInputLabel")}
        label={t("settings.configSection.steamKeyInputLabel")}
        placeholder={t("settings.configSection.steamKeyInputPlaceholder")}
        description={t(
          hasApiKey ? "settings.configSection.steamKeyReplaceHint" : "settings.configSection.steamKeyInputHint"
        )}
        type={showApiKey ? "text" : "password"}
        value={apiKey}
        onValueChange={setApiKey}
        startContent={<KeyRound size={14} className="text-default-400" aria-hidden="true" />}
        endContent={
          <button
            type="button"
            className="rounded p-1 text-default-500 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={t(showApiKey ? "settings.configSection.hideSteamKey" : "settings.configSection.showSteamKey")}
            aria-pressed={showApiKey}
            onClick={() => setShowApiKey((visible) => !visible)}>
            {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        }
        isDisabled={isLoading || saving}
        variant="bordered"
      />
      <Button
        size="sm"
        color="primary"
        variant="flat"
        isDisabled={!apiKey.trim() || saving || isLoading}
        isLoading={saving}
        onPress={handleSave}>
        {t("settings.configSection.saveSteamKey")}
      </Button>
    </div>
  );
}
