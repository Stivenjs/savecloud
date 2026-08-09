/**
 * @file LanHostList.tsx
 * @description Modal de descubrimiento mDNS de anfitriones de Remote Play en la red local.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Network, RefreshCw, Laptop, Monitor, Wifi, ChevronRight } from "lucide-react";
import { ClientConnectModal } from "@components/streaming/ClientConnectModal";
import { StreamingConfig } from "@components/streaming/streamingTypes";

/**
 * Estructura de anfitrión descubierto vía mDNS.
 */
interface DiscoveredStreamHost {
  device_id: string;
  user_id: string;
  ip: string;
  port: number;
  savecloud_port: number;
  hostname: string;
}

/**
 * Propiedades del componente LanHostList.
 */
interface LanHostListProps {
  /** Estado de apertura del modal */
  isOpen: boolean;
  /** Callback para cerrar el modal */
  onClose: () => void;
  /** Configuración opcional de streaming */
  config?: StreamingConfig;
}

/**
 * Componente que busca y muestra los equipos de la red local emitiendo Remote Play.
 *
 * @param {LanHostListProps} props Propiedades del componente
 * @returns {JSX.Element} Lista modal de anfitriones LAN
 */
export const LanHostList = ({ isOpen, onClose, config }: LanHostListProps) => {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<DiscoveredStreamHost[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedHost, setSelectedHost] = useState<DiscoveredStreamHost | null>(null);

  const mirrorHostLabel = t("remotePlay.lanHosts.mirrorHost");

  const searchHosts = useCallback(async () => {
    setIsSearching(true);
    try {
      const found = await invoke<DiscoveredStreamHost[]>("streaming_discover_lan", { timeoutSecs: 3 });
      setHosts(found);
    } catch (err) {
      console.error("Error buscando hosts LAN:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void searchHosts();
    }
  }, [isOpen, searchHosts]);

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
      <Modal
        isOpen={isOpen && !selectedHost}
        onClose={onClose}
        backdrop="blur"
        placement="center"
        scrollBehavior="inside"
        classNames={{
          base: "bg-content1/90 backdrop-blur-xl border border-default-200/50 dark:border-default-100/10 shadow-2xl rounded-3xl overflow-hidden max-w-lg",
        }}>
        <ModalContent>
          {(onCloseModal) => (
            <>
              <ModalHeader className="flex items-center justify-between pt-6 px-6 pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-primary/15 text-primary border border-primary/20 shadow-xs shrink-0">
                    <Network size={22} />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-lg font-bold text-foreground tracking-tight">
                      {t("remotePlay.lanHosts.title")}
                    </span>
                    <p className="text-xs text-default-400 font-normal">
                      Buscando equipos en tu red mediante mDNS / UDP broadcast
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={searchHosts}
                  isLoading={isSearching}
                  className="font-semibold text-xs gap-1.5 px-3">
                  <RefreshCw size={20} className={isSearching ? "hidden" : ""} />
                  {t("remotePlay.lanHosts.refresh")}
                </Button>
              </ModalHeader>

              <ModalBody className="px-6 py-4 gap-3">
                {/* Opción de Prueba en Espejo Local */}
                <div
                  className="p-4 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-2xl flex items-center justify-between transition-all cursor-pointer group shadow-xs"
                  onClick={selectMirrorHost}>
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/20 text-primary group-hover:scale-105 transition-transform shrink-0">
                      <Laptop size={20} />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-primary text-sm tracking-tight">{mirrorHostLabel}</span>
                        <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-4 px-1 font-semibold">
                          Loopback
                        </Chip>
                      </div>
                      <span className="text-default-400 text-xs font-mono mt-0.5">127.0.0.1:47989</span>
                    </div>
                  </div>
                  <Button
                    color="primary"
                    variant="flat"
                    size="sm"
                    onPress={selectMirrorHost}
                    className="font-bold text-xs gap-1">
                    {t("remotePlay.lanHosts.connect")}
                    <ChevronRight size={14} />
                  </Button>
                </div>

                {/* Separador de Lista */}
                <div className="flex items-center gap-2 py-1">
                  <span className="text-[11px] font-semibold text-default-400 uppercase tracking-wider">
                    Equipos en Red Local ({hosts.length})
                  </span>
                  <div className="h-px flex-1 bg-default-200/40 dark:bg-default-100/10" />
                </div>

                {/* Lista de Equipos Descubiertos */}
                <div className="space-y-2.5 min-h-36 max-h-64 overflow-y-auto pr-1">
                  {hosts.length === 0 && !isSearching ? (
                    <div className="p-6 text-center flex flex-col items-center justify-center gap-2 bg-default-100/30 rounded-2xl border border-default-200/30 dark:border-default-100/10">
                      <Wifi size={24} className="text-default-400 opacity-60" />
                      <p className="text-xs text-default-400 max-w-xs">{t("remotePlay.lanHosts.empty")}</p>
                    </div>
                  ) : null}

                  {isSearching && hosts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <Spinner color="primary" size="md" />
                      <p className="text-xs text-default-400">{t("remotePlay.lanHosts.searching")}</p>
                    </div>
                  ) : null}

                  {hosts.map((host) => (
                    <div
                      key={host.device_id}
                      className="p-3.5 bg-default-100/60 hover:bg-default-200/60 border border-default-200/40 dark:border-default-100/10 rounded-2xl flex items-center justify-between transition-all cursor-pointer group"
                      onClick={() => setSelectedHost(host)}>
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-default-200/60 text-default-600 group-hover:text-primary transition-colors shrink-0">
                          <Monitor size={18} />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground text-sm tracking-tight">{host.hostname}</span>
                          <span className="text-xs text-default-500 font-mono mt-0.5">
                            {host.ip}:{host.port}
                          </span>
                        </div>
                      </div>
                      <Button
                        color="primary"
                        size="sm"
                        onPress={() => setSelectedHost(host)}
                        className="font-semibold text-xs gap-1">
                        {t("remotePlay.lanHosts.connect")}
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </ModalBody>

              <ModalFooter className="px-6 pb-6 pt-2">
                <Button variant="light" onPress={onCloseModal} className="w-full font-semibold">
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
          config={config}
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
