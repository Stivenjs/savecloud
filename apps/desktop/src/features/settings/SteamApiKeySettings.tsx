import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { setSteamWebApiKey } from "@services/tauri/config.service";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Eye, EyeOff, KeyRound } from "lucide-react";
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
  const [isOpen, setIsOpen] = useState(false);

  const closeEditor = () => {
    if (saving) return;
    setIsOpen(false);
    setApiKey("");
    setShowApiKey(false);
  };

  const handleSave = async () => {
    if (!apiKey.trim()) return;

    setSaving(true);
    try {
      await setSteamWebApiKey(apiKey);
      setApiKey("");
      setShowApiKey(false);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(t("settings.configSection.steamKeySaved"));
      setIsOpen(false);
    } catch (error) {
      toastError(t("settings.configSection.steamKeySaveError"), error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default-200/70 bg-default-50/55 px-3 py-2.5 dark:border-default-100/15 dark:bg-default-50/10">
        <div className="min-w-0">
          <span className="text-xs font-medium text-default-500">{t("settings.configSection.steamKeyLabel")}</span>
          <p className={hasApiKey ? "mt-1 text-sm font-medium text-success-600" : "mt-1 text-sm text-default-400"}>
            {isLoading
              ? t("settings.configSection.steamKeyChecking")
              : t(hasApiKey ? "settings.configSection.steamKeyConfigured" : "settings.configSection.steamKeyMissing")}
          </p>
        </div>
        <Button size="sm" variant="flat" color="primary" isDisabled={isLoading} onPress={() => setIsOpen(true)}>
          {t(hasApiKey ? "settings.configSection.editSteamKey" : "settings.configSection.configureSteamKey")}
        </Button>
      </div>
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        placement="center"
        size="md">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">
              {t("settings.configSection.steamKeyDialogTitle")}
            </span>
            <span className="text-sm font-normal text-default-500">
              {t("settings.configSection.steamKeyDialogDesc")}
            </span>
          </ModalHeader>
          <ModalBody>
            <Input
              autoFocus
              label={t("settings.configSection.steamKeyInputLabel")}
              labelPlacement="outside"
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
                  aria-label={t(
                    showApiKey ? "settings.configSection.hideSteamKey" : "settings.configSection.showSteamKey"
                  )}
                  aria-pressed={showApiKey}
                  onClick={() => setShowApiKey((visible) => !visible)}>
                  {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              }
              isDisabled={saving}
              variant="bordered"
            />
            <Button
              size="sm"
              variant="light"
              className="w-fit min-w-0 justify-start px-0 text-default-500"
              startContent={<ExternalLink size={14} aria-hidden="true" />}
              onPress={() => void openUrl("https://steamcommunity.com/dev/apikey")}>
              {t("settings.configSection.getSteamApiKey")}
            </Button>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={closeEditor} isDisabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button color="primary" isDisabled={!apiKey.trim() || saving} isLoading={saving} onPress={handleSave}>
              {t("settings.configSection.saveSteamKey")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
