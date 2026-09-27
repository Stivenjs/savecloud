import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Cloud, Eye, EyeOff, KeyRound, UserRound, Wifi } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface CreateConfigModalProps {
  isOpen: boolean;
  apiBaseUrl: string;
  wsBaseUrl: string;
  apiKey: string;
  userId: string;
  error: string | null;
  creating: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onWsBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function CreateConfigModal({
  isOpen,
  apiBaseUrl,
  wsBaseUrl,
  apiKey,
  userId,
  error,
  creating,
  onApiBaseUrlChange,
  onWsBaseUrlChange,
  onApiKeyChange,
  onUserIdChange,
  onClose,
  onSubmit,
}: CreateConfigModalProps) {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="center"
      size="xl">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-1">
          <span className="text-lg font-semibold text-default-900">{t("settings.createConfigModal.title")}</span>
          <span className="text-sm font-normal text-default-500">{t("settings.createConfigModal.subtitle")}</span>
        </ModalHeader>
        <ModalBody className="max-h-[75vh] gap-5 overflow-y-auto pb-2">
          <section
            aria-labelledby="cloud-server-heading"
            className="space-y-3 border-b border-default-200/70 pb-5 dark:border-default-100/15">
            <h3
              id="cloud-server-heading"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">
              {t("settings.createConfigModal.mainConnection")}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={t("settings.createConfigModal.apiUrlLabel")}
                labelPlacement="outside"
                placeholder={t("settings.createConfigModal.apiUrlPlaceholder")}
                description={t("settings.createConfigModal.apiUrlDesc")}
                startContent={<Cloud size={14} className="text-default-400" aria-hidden="true" />}
                value={apiBaseUrl}
                onValueChange={onApiBaseUrlChange}
                variant="bordered"
              />
              <Input
                label={t("settings.createConfigModal.wsUrlLabel")}
                labelPlacement="outside"
                placeholder={t("settings.createConfigModal.wsUrlPlaceholder")}
                description={t("settings.createConfigModal.wsUrlDesc")}
                startContent={<Wifi size={14} className="text-default-400" aria-hidden="true" />}
                value={wsBaseUrl}
                onValueChange={onWsBaseUrlChange}
                variant="bordered"
              />
            </div>
          </section>
          <section aria-labelledby="cloud-account-heading" className="space-y-3">
            <h3
              id="cloud-account-heading"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">
              {t("settings.createConfigModal.credentials")}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={t("settings.createConfigModal.userIdLabel")}
                labelPlacement="outside"
                placeholder={t("settings.createConfigModal.userIdPlaceholder")}
                description={t("settings.createConfigModal.userIdDesc")}
                startContent={<UserRound size={14} className="text-default-400" aria-hidden="true" />}
                value={userId}
                onValueChange={onUserIdChange}
                variant="bordered"
              />
              <Input
                label={t("settings.createConfigModal.apiKeyLabel")}
                labelPlacement="outside"
                placeholder={t("settings.createConfigModal.apiKeyPlaceholder")}
                description={t("settings.createConfigModal.apiKeyDesc")}
                type={showApiKey ? "text" : "password"}
                startContent={<KeyRound size={14} className="text-default-400" aria-hidden="true" />}
                endContent={
                  <button
                    type="button"
                    className="rounded p-1 text-default-500 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t(
                      showApiKey ? "settings.createConfigModal.hideApiKey" : "settings.createConfigModal.showApiKey"
                    )}
                    aria-pressed={showApiKey}
                    onClick={() => setShowApiKey((visible) => !visible)}>
                    {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                }
                value={apiKey}
                onValueChange={onApiKeyChange}
                variant="bordered"
              />
            </div>
          </section>
          <p className="rounded-lg border border-default-200/70 bg-default-50/50 px-3 py-2 text-xs leading-relaxed text-default-500 dark:border-default-100/15 dark:bg-default-100/5">
            {t("settings.createConfigModal.restoreHint")}
          </p>
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
          <Button color="primary" variant="flat" onPress={onSubmit} isLoading={creating} className="font-medium">
            {t("settings.createConfigModal.saveConnection")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
