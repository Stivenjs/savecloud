import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface HostSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HostSetupModal = ({ isOpen, onClose }: HostSetupModalProps) => {
  const { t } = useTranslation();
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const startHostCalledRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const startHost = async () => {
      setIsLoading(true);
      try {
        const generatedPin = await invoke<string>("streaming_start_host", {
          deviceId: "local-pc",
          userId: "current-user",
        });
        if (isMounted) setPin(generatedPin);
      } catch (err: unknown) {
        if (isMounted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    if (isOpen && !startHostCalledRef.current) {
      startHostCalledRef.current = true;
      startHost();
    }

    if (!isOpen) {
      startHostCalledRef.current = false;
      setPin(null);
      setError(null);
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} backdrop="blur">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">{t("remotePlay.hostSetup.title")}</ModalHeader>
            <ModalBody>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4 text-default-500">
                  <Spinner size="lg" color="primary" />
                  <p>{t("remotePlay.hostSetup.configuring")}</p>
                </div>
              ) : null}

              {error ? (
                <div className="bg-danger-50 text-danger-600 dark:bg-danger-900/20 dark:text-danger-400 p-4 rounded-xl mb-4">
                  <p className="font-semibold">{t("remotePlay.hostSetup.startError")}</p>
                  <p className="text-sm">{error}</p>
                </div>
              ) : null}

              {pin ? (
                <div className="text-center py-6">
                  <p className="text-default-600 mb-4">{t("remotePlay.hostSetup.sharePin")}</p>
                  <div className="text-5xl font-mono tracking-[0.25em] bg-content2 p-6 rounded-2xl border border-default-200 text-success font-bold shadow-inner">
                    {pin}
                  </div>
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button color={pin ? "primary" : "danger"} variant="flat" onPress={onClose}>
                {pin ? t("remotePlay.hostSetup.accept") : t("remotePlay.hostSetup.cancel")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
