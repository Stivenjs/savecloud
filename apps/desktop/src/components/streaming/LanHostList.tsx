import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ClientConnectModal } from "@components/streaming/ClientConnectModal";

interface DiscoveredStreamHost {
  device_id: string;
  user_id: string;
  ip: string;
  port: number;
  savecloud_port: number;
  hostname: string;
}

interface LanHostListProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LanHostList = ({ isOpen, onClose }: LanHostListProps) => {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<DiscoveredStreamHost[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedHost, setSelectedHost] = useState<DiscoveredStreamHost | null>(null);

  const mirrorHostLabel = t("remotePlay.lanHosts.mirrorHost");

  const searchHosts = async () => {
    setIsSearching(true);
    try {
      const found = await invoke<DiscoveredStreamHost[]>("streaming_discover_lan", { timeoutSecs: 3 });
      setHosts(found);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      searchHosts();
    }
  }, [isOpen]);

  const selectMirrorHost = () =>
    setSelectedHost({
      device_id: "localhost-test",
      user_id: "local",
      ip: "127.0.0.1",
      port: 47989,
      savecloud_port: 0,
      hostname: mirrorHostLabel,
    });

  return (
    <>
      <Modal isOpen={isOpen && !selectedHost} onClose={onClose} backdrop="blur" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex justify-between items-center pr-12">
                <span>{t("remotePlay.lanHosts.title")}</span>
                <Button size="sm" color="primary" variant="flat" onPress={searchHosts} isLoading={isSearching}>
                  {t("remotePlay.lanHosts.refresh")}
                </Button>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-3 min-h-[200px]">
                  {hosts.length === 0 && !isSearching ? (
                    <div className="text-default-400 text-center flex flex-col items-center justify-center h-full py-10">
                      {t("remotePlay.lanHosts.empty")}
                    </div>
                  ) : null}

                  {isSearching && hosts.length === 0 ? (
                    <div className="flex justify-center items-center h-full py-10">
                      <Spinner color="primary" label={t("remotePlay.lanHosts.searching")} />
                    </div>
                  ) : null}

                  <div
                    className="p-4 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-xl flex justify-between items-center transition-colors cursor-pointer"
                    onClick={selectMirrorHost}>
                    <div>
                      <p className="font-bold text-primary-600 text-lg">{mirrorHostLabel}</p>
                      <p className="text-primary-400 text-sm">127.0.0.1:47989</p>
                    </div>
                    <Button color="primary" variant="flat" size="sm" onPress={selectMirrorHost}>
                      {t("remotePlay.lanHosts.connect")}
                    </Button>
                  </div>

                  {hosts.map((host) => (
                    <div
                      key={host.device_id}
                      className="p-4 bg-content2 hover:bg-content3 border border-default-200 rounded-xl flex justify-between items-center transition-colors cursor-pointer"
                      onClick={() => setSelectedHost(host)}>
                      <div>
                        <p className="font-bold text-foreground text-lg">{host.hostname}</p>
                        <p className="text-sm text-default-500 font-mono mt-1">
                          {host.ip}:{host.port}
                        </p>
                      </div>
                      <Button color="primary" size="sm" onPress={() => setSelectedHost(host)}>
                        {t("remotePlay.lanHosts.connect")}
                      </Button>
                    </div>
                  ))}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("remotePlay.lanHosts.close")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {selectedHost ? (
        <ClientConnectModal
          host={selectedHost}
          isOpen={true}
          onClose={() => {
            setSelectedHost(null);
            onClose();
          }}
        />
      ) : null}
    </>
  );
};
