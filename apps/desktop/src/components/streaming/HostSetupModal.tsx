/**
 * @file HostSetupModal.tsx
 * @description Modal de configuración e inicio del servidor anfitrión de Remote Play.
 * Diseño de alto impacto visual con estado de carga, tarjeta de PIN de alta definición e íconos dinámicos.
 */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Radio, ShieldCheck, Copy, Check, AlertCircle } from "lucide-react";
import { useStreamingState } from "@hooks/queries/useStreamingQueries";

interface HostSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal interactivo de alta fidelidad visual para la configuración del servidor anfitrión.
 */
export const HostSetupModal = ({ isOpen, onClose }: HostSetupModalProps) => {
  const { t } = useTranslation();
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const startHostCalledRef = useRef(false);

  const { data: state } = useStreamingState();
  const isHosting = typeof state === "object" && state !== null && "Hosting" in state;

  useEffect(() => {
    if (isHosting && isOpen) {
      onClose();
    }
  }, [isHosting, isOpen, onClose]);

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
      setCopied(false);
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const handleCopyPin = () => {
    if (pin) {
      void navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdrop="blur"
      placement="center"
      classNames={{
        base: "bg-content1/90 backdrop-blur-xl border border-default-200/50 dark:border-default-100/10 shadow-2xl rounded-3xl overflow-hidden max-w-md",
      }}>
      <ModalContent>
        {(onCloseModal) => (
          <>
            <ModalHeader className="flex items-center gap-3 pt-6 px-6 pb-2">
              <div className="p-2.5 rounded-2xl bg-primary/15 text-primary border border-primary/20 shadow-xs shrink-0">
                <Radio size={22} className="animate-pulse" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-foreground tracking-tight">
                    {t("remotePlay.hostSetup.title")}
                  </span>
                  <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-5 font-semibold">
                    Sunshine Host
                  </Chip>
                </div>
                <p className="text-xs text-default-400 font-normal">
                  Iniciando servidor de captura de pantalla e inputs
                </p>
              </div>
            </ModalHeader>

            <ModalBody className="px-6 py-4 gap-4">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                  <div className="relative flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 animate-ping absolute" />
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary relative">
                      <Spinner size="md" color="primary" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-bold text-foreground">{t("remotePlay.hostSetup.configuring")}</p>
                    <p className="text-xs text-default-500">Preparando puerto securizado e interfaz mDNS...</p>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="bg-danger-500/10 text-danger-500 p-4 rounded-2xl border border-danger-500/20 text-sm flex items-start gap-3">
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="font-bold text-sm">{t("remotePlay.hostSetup.startError")}</p>
                    <p className="text-xs font-mono opacity-90 wrap-break-word">{error}</p>
                  </div>
                </div>
              ) : null}

              {pin ? (
                <div className="flex flex-col gap-4 py-2">
                  <div className="p-4 rounded-2xl bg-default-100/40 border border-default-200/40 dark:border-default-100/10 flex items-center gap-3">
                    <ShieldCheck size={20} className="text-success shrink-0" />
                    <p className="text-xs text-default-500 leading-relaxed">{t("remotePlay.hostSetup.sharePin")}</p>
                  </div>

                  <div className="relative flex flex-col items-center justify-center p-6 rounded-2xl bg-linear-to-b from-default-100/80 to-default-50/50 border border-primary/30 shadow-inner group">
                    <div className="text-4xl font-mono tracking-[0.3em] text-primary font-extrabold select-all text-center">
                      {pin}
                    </div>
                    <Button
                      size="sm"
                      variant="flat"
                      color={copied ? "success" : "primary"}
                      onPress={handleCopyPin}
                      className="mt-3 text-xs font-semibold gap-1.5 px-3 h-7">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "¡Copiado!" : "Copiar PIN"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </ModalBody>

            <ModalFooter className="px-6 pb-6 pt-2">
              <Button
                color={pin ? "primary" : "danger"}
                variant="flat"
                onPress={onCloseModal}
                className="w-full font-semibold">
                {pin ? t("remotePlay.hostSetup.accept") : t("remotePlay.hostSetup.cancel")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
