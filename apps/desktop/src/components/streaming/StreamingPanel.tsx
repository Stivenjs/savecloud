import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardHeader, CardBody } from "@heroui/react";
import { HostSetupModal } from "@components/streaming/HostSetupModal";
import { LanHostList } from "@components/streaming/LanHostList";

export type StreamingState =
  | "NotInstalled"
  | "Stopped"
  | "Running"
  | { Hosting: { pin: string; clients: string[] } }
  | { Playing: { host_ip: string; ws_port: number } }
  | { Error: string }
  | "Idle";

export const StreamingPanel = () => {
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: state } = useQuery<StreamingState>({
    queryKey: ["streaming_get_state"],
    queryFn: () => invoke("streaming_get_state"),
    refetchInterval: 2000,
  });

  const isHosting = typeof state === "object" && state !== null && "Hosting" in state;
  const isPlaying = typeof state === "object" && state !== null && "Playing" in state;
  const isIdle = state === "Idle" || state === "NotInstalled" || state === "Stopped";

  const handleStop = async () => {
    await invoke("streaming_stop");
    await queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
  };

  return (
    <Card className="w-full max-w-2xl bg-content1 border-default-200">
      <CardHeader className="flex flex-col items-start px-6 pt-6 pb-2">
        <h2 className="text-2xl font-bold text-foreground">Remote Play (LAN)</h2>
        <p className="text-sm text-default-500">Transmite o juega en red local</p>
      </CardHeader>
      <CardBody className="px-6 pb-6 gap-4">
        {isHosting ? (
          <div className="p-4 bg-success-50 dark:bg-success-900/20 border border-success-500/50 rounded-xl">
            <h3 className="text-lg font-semibold text-success-600 dark:text-success-400">Hosting Session Active</h3>
            <p className="text-sm text-default-600 dark:text-default-300 mb-4">
              Esperando conexiones en tu red local. Tus dispositivos se emparejarán automáticamente gracias a SaveCloud
              Zero-Config.
            </p>
            <Button color="danger" variant="flat" onPress={handleStop}>
              Detener Host
            </Button>
          </div>
        ) : null}

        {isPlaying ? (
          <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-500/50 rounded-xl">
            <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-400">Conectado al Host</h3>
            <p className="text-sm text-default-600 dark:text-default-300 mb-4">
              Recibiendo transmisión desde {(state as any).Playing.host_ip}
            </p>
            <Button color="danger" variant="flat" onPress={handleStop}>
              Desconectar
            </Button>
          </div>
        ) : null}

        {isIdle ? (
          <div className="grid grid-cols-2 gap-4 mt-2">
            <Button
              color="primary"
              variant="flat"
              className="h-24 flex flex-col gap-1"
              onPress={() => setIsHostModalOpen(true)}>
              <span className="text-lg font-medium">Ser Anfitrión</span>
              <span className="text-xs opacity-80">Comparte tu pantalla</span>
            </Button>

            <Button
              color="default"
              variant="bordered"
              className="h-24 flex flex-col gap-1"
              onPress={() => setIsBrowserOpen(true)}>
              <span className="text-lg font-medium">Unirse a Juego</span>
              <span className="text-xs opacity-80">Busca hosts en LAN</span>
            </Button>
          </div>
        ) : null}

        {isHostModalOpen ? (
          <HostSetupModal
            isOpen={isHostModalOpen}
            onClose={() => {
              setIsHostModalOpen(false);
              queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
            }}
          />
        ) : null}

        {isBrowserOpen ? (
          <LanHostList
            isOpen={isBrowserOpen}
            onClose={() => {
              setIsBrowserOpen(false);
              queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
            }}
          />
        ) : null}
      </CardBody>
    </Card>
  );
};
