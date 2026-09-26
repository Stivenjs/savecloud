import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CONFIG_EXPORT_MIN_PASSWORD_LENGTH, type ConfigEncryptionDialogMode } from "@features/settings/configExport";

interface ConfigEncryptionModalProps {
  mode: ConfigEncryptionDialogMode;
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void | Promise<void>;
}

export function ConfigEncryptionModal({ mode, error, isLoading, onClose, onSubmit }: ConfigEncryptionModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogKey = mode?.kind === "import" ? `import-${mode.importMode}` : (mode?.kind ?? "closed");
  const isExport = mode?.kind === "export";
  const isOpen = mode !== null;
  const descriptionKey = isExport
    ? "settings.configEncryptionModal.exportDescription"
    : mode?.kind === "import" && mode.importMode === "merge"
      ? "settings.configEncryptionModal.importMergeDescription"
      : "settings.configEncryptionModal.importReplaceDescription";

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
    setShowConfirmation(false);
    setValidationError(null);
  }, [dialogKey]);

  const handleSubmit = () => {
    setValidationError(null);
    if (Array.from(password).length < CONFIG_EXPORT_MIN_PASSWORD_LENGTH) {
      setValidationError(
        t("settings.configEncryptionModal.passwordTooShort", { count: CONFIG_EXPORT_MIN_PASSWORD_LENGTH })
      );
      return;
    }
    if (isExport && password !== confirmation) {
      setValidationError(t("settings.configEncryptionModal.passwordMismatch"));
      return;
    }
    void onSubmit(password);
  };

  return (
    <Modal
      isOpen={isOpen}
      isDismissable={!isLoading}
      onOpenChange={(open) => {
        if (!open && !isLoading) onClose();
      }}
      placement="center"
      size="md">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-2">
          <span className="text-base font-semibold text-default-900">
            {t(isExport ? "settings.configEncryptionModal.exportTitle" : "settings.configEncryptionModal.importTitle")}
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-primary">
            {t(
              isExport ? "settings.configEncryptionModal.exportEyebrow" : "settings.configEncryptionModal.importEyebrow"
            )}
          </span>
        </ModalHeader>
        <ModalBody className="gap-4 pb-2">
          <p className="text-sm leading-relaxed text-default-600">{t(descriptionKey)}</p>
          <Input
            autoFocus
            label={t("settings.configEncryptionModal.passwordLabel")}
            type={showPassword ? "text" : "password"}
            autoComplete={isExport ? "new-password" : "current-password"}
            value={password}
            onValueChange={(value) => {
              setPassword(value);
              setValidationError(null);
            }}
            endContent={
              <button
                type="button"
                aria-label={t(
                  showPassword
                    ? "settings.configEncryptionModal.hidePassword"
                    : "settings.configEncryptionModal.showPassword"
                )}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                className="rounded-md p-1 text-default-500 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            }
            variant="bordered"
          />
          {isExport ? (
            <Input
              label={t("settings.configEncryptionModal.confirmPasswordLabel")}
              type={showConfirmation ? "text" : "password"}
              autoComplete="new-password"
              value={confirmation}
              onValueChange={(value) => {
                setConfirmation(value);
                setValidationError(null);
              }}
              endContent={
                <button
                  type="button"
                  aria-label={t(
                    showConfirmation
                      ? "settings.configEncryptionModal.hidePassword"
                      : "settings.configEncryptionModal.showPassword"
                  )}
                  aria-pressed={showConfirmation}
                  onClick={() => setShowConfirmation((visible) => !visible)}
                  className="rounded-md p-1 text-default-500 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">
                  {showConfirmation ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              }
              variant="bordered"
            />
          ) : null}
          {isExport ? (
            <p className="rounded-lg border border-warning-200/70 bg-warning-50/70 px-3 py-2 text-xs leading-relaxed text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300">
              {t("settings.configEncryptionModal.passwordWarning")}
            </p>
          ) : null}
          {validationError || error ? (
            <p role="alert" className="text-sm text-danger">
              {validationError ?? error}
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button variant="flat" onPress={onClose} isDisabled={isLoading} className="font-medium">
            {t("common.cancel")}
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={isLoading} className="font-semibold">
            {t(
              isExport ? "settings.configEncryptionModal.exportAction" : "settings.configEncryptionModal.importAction"
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
