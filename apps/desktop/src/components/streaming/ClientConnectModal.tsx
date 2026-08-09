/**
 * @file ClientConnectModal.tsx
 * @description Modal interactivo para conectar el cliente a un host de Remote Play en la LAN
 * utilizando la configuración de streaming activa (resolución, FPS, bitrate y códec).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Monitor, AlertCircle, RefreshCw } from "lucide-react";
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
                <Monitor size={22} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-foreground tracking-tight truncate">
                    {t("remotePlay.clientConnect.title", { hostname: host.hostname })}
                  </span>
                </div>
                <p className="text-xs text-default-400 font-normal">Iniciando flujo RTSP securizado ({host.ip})</p>
              </div>
            </ModalHeader>

            <ModalBody className="px-6 py-4 gap-4">
              {isConnecting ? (
                <div className="flex flex-col items-center justify-center py-8 gap-5 text-center">
                  <div className="relative flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 animate-ping absolute" />
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary relative">
                      <Spinner size="md" color="primary" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-bold text-foreground">{t("remotePlay.clientConnect.establishing")}</p>
                    <p className="text-xs text-default-500">Realizando handshake de emparejamiento TLS...</p>
                  </div>

                  {/* Ficha técnica de la sesión */}
                  <div className="flex flex-wrap items-center justify-center gap-2 p-3 bg-default-100/40 rounded-2xl border border-default-200/40 dark:border-default-100/10 w-full text-xs">
                    <Chip size="sm" variant="flat" color="primary" className="font-semibold text-[11px]">
                      {resDetails.label}
                    </Chip>
                    <Chip size="sm" variant="flat" color="primary" className="font-semibold text-[11px]">
                      {activeConfig.fps} FPS
                    </Chip>
                    <Chip size="sm" variant="flat" color="primary" className="font-semibold text-[11px]">
                      {activeConfig.bitrateMbps} Mbps
                    </Chip>
                    <Chip size="sm" variant="flat" color="primary" className="font-semibold text-[11px]">
                      {activeConfig.codec.toUpperCase()}
                    </Chip>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="bg-danger-500/10 text-danger-500 p-4 rounded-2xl border border-danger-500/20 text-sm flex items-start gap-3">
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="font-bold text-sm">{t("remotePlay.clientConnect.errorTitle")}</p>
                    <p className="text-xs font-mono opacity-90 wrap-break-word">{error}</p>
                  </div>
                </div>
              ) : null}
            </ModalBody>

            <ModalFooter className="px-6 pb-6 pt-2 gap-2">
              <Button
                variant="light"
                onPress={onCloseModal}
                isDisabled={isConnecting}
                className="font-semibold text-xs flex-1">
                {t("remotePlay.clientConnect.close")}
              </Button>
              {error ? (
                <Button
                  color="primary"
                  onPress={handleConnect}
                  isLoading={isConnecting}
                  className="font-semibold text-xs flex-1 gap-1.5">
                  <RefreshCw size={14} />
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
