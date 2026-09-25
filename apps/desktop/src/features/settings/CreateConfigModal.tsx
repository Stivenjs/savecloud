import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, KeyRound, UserRound, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CreateConfigModalProps {
  isOpen: boolean;
  apiBaseUrl: string;
  wsBaseUrl: string;
  apiKey: string;
  userId: string;
  steamWebApiKey: string;
  error: string | null;
  creating: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onWsBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onSteamWebApiKeyChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (restoreAfter: boolean) => void | Promise<void>;
}

export function CreateConfigModal({
  isOpen,
  apiBaseUrl,
  wsBaseUrl,
  apiKey,
  userId,
  steamWebApiKey,
  error,
  creating,
  onApiBaseUrlChange,
  onWsBaseUrlChange,
  onApiKeyChange,
  onUserIdChange,
  onSteamWebApiKeyChange,
  onClose,
  onSubmit,
}: CreateConfigModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="center"
      size="lg">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-2">
          <span className="text-base font-semibold text-default-900">{t("settings.createConfigModal.title")}</span>
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-primary">
            {t("settings.createConfigModal.step")}
          </span>
        </ModalHeader>
        <ModalBody className="gap-5 pb-2">
          <p className="rounded-large border border-default-200 bg-default-50 px-3 py-2 text-sm text-default-600 dark:border-default-100/10 dark:bg-default-100/5 dark:text-default-400">
            {t("settings.createConfigModal.intro")
              .split("<br/>")
              .map((line, idx) => (
                <span key={idx}>
                  {line}
                  {idx < t("settings.createConfigModal.intro").split("<br/>").length - 1 && <br />}
                </span>
              ))}
          </p>
          <div className="space-y-3 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">
              {t("settings.createConfigModal.mainConnection")}
            </p>
            <Input
              label={t("settings.createConfigModal.apiUrlLabel")}
              placeholder={t("settings.createConfigModal.apiUrlPlaceholder")}
              description={t("settings.createConfigModal.apiUrlDesc")}
              startContent={<Cloud size={14} className="text-default-400" />}
              value={apiBaseUrl}
              onValueChange={onApiBaseUrlChange}
              variant="bordered"
            />
            <Input
              label={t("settings.createConfigModal.wsUrlLabel")}
              placeholder={t("settings.createConfigModal.wsUrlPlaceholder")}
              description={t("settings.createConfigModal.wsUrlDesc")}
              startContent={<Wifi size={14} className="text-default-400" />}
              value={wsBaseUrl}
              onValueChange={onWsBaseUrlChange}
              variant="bordered"
            />
          </div>
          <div className="space-y-3 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">
              {t("settings.createConfigModal.credentials")}
            </p>
            <Input
              label={t("settings.createConfigModal.userIdLabel")}
              placeholder={t("settings.createConfigModal.userIdPlaceholder")}
              description={t("settings.createConfigModal.userIdDesc")}
              startContent={<UserRound size={14} className="text-default-400" />}
              value={userId}
              onValueChange={onUserIdChange}
              variant="bordered"
            />
            <Input
              label={t("settings.createConfigModal.apiKeyLabel")}
              placeholder={t("settings.createConfigModal.apiKeyPlaceholder")}
              description={t("settings.createConfigModal.apiKeyDesc")}
              type="password"
              startContent={<KeyRound size={14} className="text-default-400" />}
              value={apiKey}
              onValueChange={onApiKeyChange}
              variant="bordered"
            />
          </div>
          <div className="space-y-2 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">
              {t("settings.createConfigModal.optionalIntegration")}
            </p>
            <Input
              label={t("settings.createConfigModal.steamKeyLabel")}
              placeholder={t("settings.createConfigModal.steamKeyPlaceholder")}
              description={t("settings.createConfigModal.steamKeyDesc")}
              type="password"
              value={steamWebApiKey}
              onValueChange={onSteamWebApiKeyChange}
              variant="bordered"
            />
            <Button
              size="sm"
              variant="light"
              className="min-w-0 justify-start px-0 text-default-500"
              startContent={<ExternalLink size={14} />}
              onPress={() => void openUrl("https://steamcommunity.com/dev/apikey")}>
              {t("settings.createConfigModal.getSteamKey")}
            </Button>
          </div>
          {error ? (
            <div className="rounded-medium border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-500/10 dark:text-danger-300">
              {t("settings.createConfigModal.connectError")}
              <br />
              <span className="text-xs opacity-80">{error}</span>
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button variant="flat" onPress={onClose} className="font-medium">
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            variant="flat"
            onPress={() => onSubmit(false)}
            isLoading={creating}
            className="font-medium">
            {t("settings.createConfigModal.saveOnly")}
          </Button>
          <Button color="secondary" onPress={() => onSubmit(true)} isLoading={creating} className="font-semibold">
            {t("settings.createConfigModal.saveAndRecover")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
