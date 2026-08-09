/**
 * @file ClientConnectModal.tsx
 * @description Modal interactivo para conectar el cliente a un host de Remote Play en la LAN
 * utilizando la configuración de streaming activa (resolución, FPS, bitrate y códec).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { openOrFocusStreamingWindow } from "@/windows/streamingWindow";
import { getSavedStreamingConfig, RESOLUTION_OPTIONS, StreamingConfig } from "@components/streaming/streamingTypes";

/**
 * Propiedades para el modal de conexión a anfitrión.
 */
interface ClientConnectModalProps {
  /** Objeto con datos del host descubierto (IP, nombre, puerto) */
  host: { ip: string; hostname: string; savecloud_port: number };
  /** Estado de visibilidad del modal */
  isOpen: boolean;
  /** Función callback al cerrar el modal */
  onClose: () => void;
  /** Configuración de streaming opcional. Si no se pasa, se lee de localStorage */
  config?: StreamingConfig;
}

/**
 * Modal que gestiona el proceso de autenticación, handshake y apertura de ventana de Remote Play.
 *
 * @param {ClientConnectModalProps} props Propiedades del componente
 * @returns {JSX.Element} Componente renderizado
 */
export const ClientConnectModal = ({ host, isOpen, onClose, config }: ClientConnectModalProps) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const hasConnectedRef = useRef(false);

  const activeConfig = config ?? getSavedStreamingConfig();
  const resDetails = RESOLUTION_OPTIONS[activeConfig.resolution];

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const wsPort = await invoke<number>("streaming_connect_lan", {
        ipAddress: host.ip,
        savecloudPort: host.savecloud_port,
        width: resDetails.width,
        height: resDetails.height,
        fps: activeConfig.fps,
        bitrateKbps: Math.round(activeConfig.bitrateMbps * 1000),
        codec: activeConfig.codec,
      });
      await openOrFocusStreamingWindow(wsPort);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }, [
    host.ip,
    host.savecloud_port,
    resDetails.width,
    resDetails.height,
    activeConfig.fps,
    activeConfig.bitrateMbps,
    activeConfig.codec,
    onClose,
  ]);

  useEffect(() => {
    if (isOpen && !hasConnectedRef.current) {
      hasConnectedRef.current = true;
      void handleConnect();
    }
    if (!isOpen) {
      hasConnectedRef.current = false;
    }
  }, [isOpen, handleConnect]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} backdrop="blur" placement="center">
      <ModalContent>
        {(onCloseModal) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              {t("remotePlay.clientConnect.title", { hostname: host.hostname })}
            </ModalHeader>
            <ModalBody>
              {isConnecting ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Spinner size="lg" color="primary" />
                  <p className="text-default-500 font-medium">{t("remotePlay.clientConnect.establishing")}</p>
                  <p className="text-xs text-default-400 font-mono">
                    {resDetails.width}x{resDetails.height} @ {activeConfig.fps} FPS ({activeConfig.bitrateMbps} Mbps |{" "}
                    {activeConfig.codec.toUpperCase()})
                  </p>
                </div>
              ) : null}

              {error ? (
                <div className="text-danger-500 text-sm mt-2 text-center bg-danger-50 dark:bg-danger-900/20 p-4 rounded-xl border border-danger-200 dark:border-danger-800">
                  <p className="font-bold mb-1">{t("remotePlay.clientConnect.errorTitle")}</p>
                  <p className="font-mono text-xs">{error}</p>
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onCloseModal} isDisabled={isConnecting}>
                {t("remotePlay.clientConnect.close")}
              </Button>
              {error ? (
                <Button color="primary" onPress={handleConnect} isLoading={isConnecting}>
                  {t("remotePlay.clientConnect.retry")}
                </Button>
              ) : null}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
