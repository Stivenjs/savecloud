import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";

interface ClientConnectModalProps {
  host: { ip: string; hostname: string; savecloud_port: number };
  isOpen: boolean;
  onClose: () => void;
}

import { openOrFocusStreamingWindow } from "@/windows/streamingWindow";

export const ClientConnectModal = ({ host, isOpen, onClose }: ClientConnectModalProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const wsPort = await invoke<number>("streaming_connect_lan", {
        ipAddress: host.ip,
        savecloudPort: host.savecloud_port,
      });
      await openOrFocusStreamingWindow(wsPort);
      onClose();
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleConnect();
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} backdrop="blur" placement="center">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">Conectando a {host.hostname}</ModalHeader>
            <ModalBody>
              {isConnecting ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Spinner size="lg" color="primary" />
                  <p className="mt-4 text-default-500 font-medium">
                    Estableciendo conexión segura sin configuración...
                  </p>
                </div>
              ) : null}

              {error ? (
                <div className="text-danger-500 text-sm mt-2 text-center bg-danger-50 p-4 rounded-lg border border-danger-200">
                  <p className="font-bold mb-1">Error de conexión</p>
                  {error}
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose} isDisabled={isConnecting}>
                Cerrar
              </Button>
              {error ? (
                <Button color="primary" onPress={handleConnect} isLoading={isConnecting}>
                  Reintentar
                </Button>
              ) : null}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
