import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardHeader, CardBody } from "@heroui/react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: state } = useQuery<StreamingState>({
    queryKey: ["streaming_get_state"],
    queryFn: () => invoke("streaming_get_state"),
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("streaming-state-changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  const isHosting = typeof state === "object" && state !== null && "Hosting" in state;
  const isPlaying = typeof state === "object" && state !== null && "Playing" in state;
  const isIdle = state === "Idle" || state === "NotInstalled" || state === "Stopped";

  const handleStop = async () => {
    await invoke("streaming_stop");
    await queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
  };

  const playingHostIp =
    isPlaying && typeof state === "object" && state !== null && "Playing" in state ? state.Playing.host_ip : "";

  return (
    <Card className="w-full max-w-2xl bg-content1 border-default-200">
      <CardHeader className="flex flex-col items-start px-6 pt-6 pb-2">
        <h2 className="text-2xl font-bold text-foreground">{t("remotePlay.title")}</h2>
        <p className="text-sm text-default-500">{t("remotePlay.panelSubtitle")}</p>
      </CardHeader>
      <CardBody className="px-6 pb-6 gap-4">
        {isHosting ? (
          <div className="p-4 bg-success-50 dark:bg-success-900/20 border border-success-500/50 rounded-xl">
            <h3 className="text-lg font-semibold text-success-600 dark:text-success-400">
              {t("remotePlay.hostingActive")}
            </h3>
            <p className="text-sm text-default-600 dark:text-default-300 mb-4">{t("remotePlay.hostingDesc")}</p>
            <Button color="danger" variant="flat" onPress={handleStop}>
              {t("remotePlay.stopHost")}
            </Button>
          </div>
        ) : null}

        {isPlaying ? (
          <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-500/50 rounded-xl">
            <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-400">
              {t("remotePlay.connectedToHost")}
            </h3>
            <p className="text-sm text-default-600 dark:text-default-300 mb-4">
              {t("remotePlay.connectedDesc", { hostIp: playingHostIp })}
            </p>
            <Button color="danger" variant="flat" onPress={handleStop}>
              {t("remotePlay.disconnect")}
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
              <span className="text-lg font-medium">{t("remotePlay.host")}</span>
              <span className="text-xs opacity-80">{t("remotePlay.hostSubtitle")}</span>
            </Button>

            <Button
              color="default"
              variant="bordered"
              className="h-24 flex flex-col gap-1"
              onPress={() => setIsBrowserOpen(true)}>
              <span className="text-lg font-medium">{t("remotePlay.join")}</span>
              <span className="text-xs opacity-80">{t("remotePlay.joinSubtitle")}</span>
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
