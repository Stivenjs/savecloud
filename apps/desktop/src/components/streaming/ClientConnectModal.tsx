import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from "@heroui/react";

interface ClientConnectModalProps {
  host: { ip: string; hostname: string };
  isOpen: boolean;
  onClose: () => void;
}

export const ClientConnectModal = ({ host, isOpen, onClose }: ClientConnectModalProps) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin.length < 4) return;

    setIsConnecting(true);
    setError(null);
    try {
      await invoke("streaming_connect_lan", {
        ipAddress: host.ip,
        pin: pin,
      });
      onClose();
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} backdrop="blur" placement="center">
      <ModalContent>
        {(onClose) => (
          <form onSubmit={handleConnect}>
            <ModalHeader className="flex flex-col gap-1">Conectar a {host.hostname}</ModalHeader>
            <ModalBody>
              <p className="text-default-500 text-sm mb-2">
                Ingresa el PIN numérico de 4 dígitos que se muestra en la pantalla del anfitrión.
              </p>

              <div className="flex justify-center py-4">
                <Input
                  type="text"
                  maxLength={4}
                  value={pin}
                  onValueChange={(val) => setPin(val.replace(/[^0-9]/g, ""))}
                  placeholder="1234"
                  size="lg"
                  className="w-48 font-mono text-center tracking-[0.5em] text-3xl"
                  classNames={{
                    input: "text-center tracking-[0.5em] text-3xl font-bold h-16",
                  }}
                  autoFocus
                />
              </div>

              {/* Vercel Best Practice: conditional rendering with ternary */}
              {error ? (
                <div className="text-danger-500 text-sm mt-2 text-center bg-danger-50 p-2 rounded-lg">{error}</div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose} isDisabled={isConnecting}>
                Cancelar
              </Button>
              <Button
                color="primary"
                type="submit"
                isDisabled={isConnecting || pin.length < 4}
                isLoading={isConnecting}>
                Conectar
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
};
