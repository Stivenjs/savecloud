import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";

interface HostSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HostSetupModal = ({ isOpen, onClose }: HostSetupModalProps) => {
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
      } catch (err: any) {
        if (isMounted) setError(err.toString());
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    if (isOpen) {
      startHost();
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
            <ModalHeader className="flex flex-col gap-1">Iniciando Sesión de Host</ModalHeader>
            <ModalBody>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4 text-default-500">
                  <Spinner size="lg" color="primary" />
                  <p>Descargando y configurando Sunshine...</p>
                </div>
              ) : null}

              {error ? (
                <div className="bg-danger-50 text-danger-600 dark:bg-danger-900/20 dark:text-danger-400 p-4 rounded-xl mb-4">
                  <p className="font-semibold">Error al iniciar</p>
                  <p className="text-sm">{error}</p>
                </div>
              ) : null}

              {pin ? (
                <div className="text-center py-6">
                  <p className="text-default-600 mb-4">Comparte este PIN con el cliente para conectar:</p>
                  <div className="text-5xl font-mono tracking-[0.25em] bg-content2 p-6 rounded-2xl border border-default-200 text-success font-bold shadow-inner">
                    {pin}
                  </div>
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button color={pin ? "primary" : "danger"} variant="flat" onPress={onClose}>
                {pin ? "Aceptar" : "Cancelar"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
