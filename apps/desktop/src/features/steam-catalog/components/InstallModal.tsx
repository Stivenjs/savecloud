import { useState, useMemo, useEffect } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  ScrollShadow,
  Select,
  SelectItem,
  cn,
} from "@heroui/react";
import { HardDrive, AlertCircle, FolderOpen, Globe, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  downloadKindDescription,
  downloadKindLabel,
  resolveDefaultDownloadKind,
  getHosterDisplayName,
  hosterProtocolLabel,
  selectableHttpUris,
  type EffectiveDownloadKind,
} from "@utils/sourceMatch";
import type { ConfiguredGame } from "@app-types/config";
import type { SourceUri } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import { useDisks } from "@hooks/useDisks";
import { formatBytes } from "@utils/format";
import { open } from "@tauri-apps/plugin-dialog";
import { parseSize } from "@utils/size";
import type { PeerInstallOffer } from "@services/tauri/inventory.service";
import { InstallModalGameCover } from "@features/steam-catalog/components/InstallModalGameCover";

export interface InstallModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  gameName: string;
  gameSizeStr?: string | null;
  game: ConfiguredGame;
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
  /** Protocolos disponibles del ítem; define el método mostrado (torrent vs HTTP). */
  protocols?: readonly string[] | null;
  /** URIs del ítem elegido; si hay varios hosters HTTP, se muestra selector en el modal. */
  uris?: readonly SourceUri[] | null;
  peerOffers?: PeerInstallOffer[];
  selectedPeerDeviceId?: string | null;
  onSelectPeerDevice?: (deviceId: string) => void;
  onConfirm: (path: string, selectedUri?: string | null) => void;
  onConfirmPeer?: (path: string, offer: PeerInstallOffer) => void;
  consoleMode?: boolean;
}

const DEFAULT_DOWNLOAD_SUBFOLDER = "SaveCloudGames";

export function InstallModal({
  isOpen,
  onOpenChange,
  gameName,
  gameSizeStr,
  game,
  mediaBySteamAppId,
  protocols,
  uris,
  peerOffers = [],
  selectedPeerDeviceId,
  onSelectPeerDevice,
  onConfirm,
  onConfirmPeer,
  consoleMode = false,
}: InstallModalProps) {
  const { t } = useTranslation();
  const { disks, refreshDisks } = useDisks();
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [selectedHosterUri, setSelectedHosterUri] = useState<string | null>(null);

  const httpUris = useMemo(() => selectableHttpUris(uris ?? undefined), [uris]);
  const showHosterSelect = httpUris.length > 1;

  useEffect(() => {
    if (isOpen) {
      void refreshDisks();
    }
  }, [isOpen, refreshDisks]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedHosterUri(null);
      return;
    }
    setSelectedHosterUri(httpUris[0]?.uri ?? null);
  }, [isOpen, httpUris]);

  const sanitizeFolderName = (name: string) => {
    return name.replace(/[:*?"<>|/\\]/g, "").trim();
  };

  const normalizeDisplayPath = (base: string, sub: string) => {
    const b = base.endsWith("\\") || base.endsWith("/") ? base : `${base}\\`;
    return `${b}${sub}`;
  };

  const gameSizeBytes = useMemo(() => parseSize(gameSizeStr), [gameSizeStr]);

  const downloadKind: EffectiveDownloadKind = useMemo(
    () => resolveDefaultDownloadKind(protocols ?? undefined),
    [protocols]
  );

  const handleCustomFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("steamCatalog.installModal.selectFolderTitle", { name: gameName }),
    });
    if (selected && typeof selected === "string") {
      setCustomPath(selected);
      setSelectedDisk(null);
    }
  };

  const currentSelectionPath = customPath || selectedDisk;

  const effectiveDisk = useMemo(() => {
    if (customPath) {
      const lowerPath = customPath.toLowerCase().replace(/\//g, "\\");
      return disks.find((d) => {
        const lowerMount = d.mountPoint.toLowerCase().replace(/\//g, "\\");
        return lowerPath.startsWith(lowerMount);
      });
    }
    return disks.find((d) => d.mountPoint === selectedDisk);
  }, [customPath, selectedDisk, disks]);

  const hasEnoughSpace = useMemo(() => {
    if (gameSizeBytes === 0) return true;
    if (!effectiveDisk) return !currentSelectionPath;
    return effectiveDisk.availableSpace >= gameSizeBytes;
  }, [effectiveDisk, gameSizeBytes, currentSelectionPath]);

  const effectivePath = useMemo(() => {
    if (customPath) return customPath;
    if (selectedDisk) {
      const base = normalizeDisplayPath(selectedDisk, DEFAULT_DOWNLOAD_SUBFOLDER);
      return normalizeDisplayPath(base, sanitizeFolderName(gameName));
    }
    return null;
  }, [customPath, selectedDisk, gameName]);

  const selectedPeer = useMemo(
    () => peerOffers.find((o) => o.deviceId === selectedPeerDeviceId) ?? peerOffers[0] ?? null,
    [peerOffers, selectedPeerDeviceId]
  );

  const peerReachable = selectedPeer?.reachableOnLan === true;

  const handleInstall = () => {
    if (!effectivePath) return;
    if (peerReachable && selectedPeer && onConfirmPeer) {
      onConfirmPeer(effectivePath, selectedPeer);
    } else {
      onConfirm(effectivePath, showHosterSelect ? selectedHosterUri : null);
    }
    onOpenChange(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={consoleMode ? "4xl" : "2xl"}
      classNames={{
        base: cn("bg-content1 text-foreground border border-divider", consoleMode ? "p-4 rounded-2xl" : ""),
        header: cn("border-b border-divider pb-4", consoleMode ? "px-6 pt-6" : ""),
        footer: cn("border-t border-divider pt-4", consoleMode ? "px-6 pb-6" : ""),
      }}
      backdrop="blur">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className={cn("font-bold tracking-tight text-foreground", consoleMode ? "text-2xl" : "text-xl")}>
                {t("steamCatalog.installModal.title")}
              </h2>
            </ModalHeader>
            <ModalBody className="py-6">
              {/* Game Info Header */}
              <div
                className={cn(
                  "flex items-center border border-divider rounded-xl",
                  consoleMode ? "gap-6 p-6 mb-8 bg-content2/80" : "gap-4 p-4 mb-6 bg-content2"
                )}>
                <div
                  className={cn(
                    "aspect-video shrink-0 overflow-hidden rounded-lg bg-default-100",
                    consoleMode ? "w-48" : "w-32"
                  )}>
                  <InstallModalGameCover game={game} alt={gameName} mediaBySteamAppId={mediaBySteamAppId} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={cn("font-bold truncate text-foreground", consoleMode ? "text-2xl" : "text-lg")}>
                    {gameName}
                  </h3>
                  <p className={cn("text-default-500 font-medium", consoleMode ? "text-base mt-1" : "text-sm")}>
                    {t("steamCatalog.installModal.requiredSize")}{" "}
                    <span className="text-foreground">{gameSizeStr || t("steamCatalog.installModal.unknownSize")}</span>
                  </p>
                  {downloadKind !== "unknown" ? (
                    <div
                      className={cn(
                        "mt-2 inline-flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                        downloadKind === "torrent"
                          ? "border-secondary/30 bg-secondary/10 text-secondary"
                          : "border-primary/30 bg-primary/10 text-primary"
                      )}>
                      {downloadKind === "torrent" ? (
                        <Share2 size={14} className="mt-0.5 shrink-0" aria-hidden />
                      ) : (
                        <Globe size={14} className="mt-0.5 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0">
                        <span className="font-semibold">{downloadKindLabel(downloadKind)}</span>
                        <span className="mt-0.5 block font-normal opacity-90">
                          {downloadKindDescription(downloadKind)}
                        </span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                {showHosterSelect ? (
                  <div className="space-y-2">
                    <h4
                      className={cn(
                        "font-bold uppercase tracking-widest text-default-400 px-1",
                        consoleMode ? "text-sm" : "text-xs"
                      )}>
                      {t("steamCatalog.installModal.chooseHoster")}
                    </h4>
                    <Select
                      label={t("steamCatalog.installModal.chooseHoster")}
                      placeholder={t("steamCatalog.installModal.selectHoster")}
                      size={consoleMode ? "lg" : "sm"}
                      variant="bordered"
                      className="w-full"
                      selectionMode="single"
                      selectedKeys={new Set([selectedHosterUri ?? httpUris[0]?.uri ?? ""])}
                      onSelectionChange={(keys) => {
                        const next = [...keys][0];
                        if (next !== undefined) setSelectedHosterUri(String(next));
                      }}
                      classNames={
                        consoleMode
                          ? {
                              trigger: "h-12 min-h-12 rounded-xl text-base",
                              value: "text-base font-semibold",
                            }
                          : undefined
                      }>
                      {httpUris.map((u) => (
                        <SelectItem key={u.uri} textValue={getHosterDisplayName(u.uri)}>
                          <span className="capitalize">{getHosterDisplayName(u.uri)}</span>
                          <span className="ml-2 text-xs text-default-400">{hosterProtocolLabel(u.protocol)}</span>
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                ) : null}

                <div className="flex items-center justify-between px-1">
                  <h4
                    className={cn(
                      "font-bold uppercase tracking-widest text-default-400",
                      consoleMode ? "text-sm" : "text-xs"
                    )}>
                    {t("steamCatalog.installModal.installIn")}
                  </h4>
                  <Button
                    size={consoleMode ? "md" : "sm"}
                    variant="light"
                    startContent={<FolderOpen size={consoleMode ? 16 : 14} />}
                    className={cn(
                      "text-primary px-2",
                      consoleMode ? "h-9 text-sm font-semibold rounded-xl" : "h-7 min-w-unit-0 text-xs"
                    )}
                    onPress={handleCustomFolder}>
                    {t("steamCatalog.installModal.chooseAnotherFolder")}
                  </Button>
                </div>

                {customPath && (
                  <div
                    className={cn(
                      "rounded-lg bg-primary/10 border border-primary/20 flex items-center",
                      consoleMode ? "p-4 gap-4" : "p-3 gap-3"
                    )}>
                    <div className={cn("bg-primary/20 rounded-md text-primary", consoleMode ? "p-3" : "p-2")}>
                      <FolderOpen size={consoleMode ? 22 : 18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("font-bold text-primary uppercase", consoleMode ? "text-xs" : "text-[10px]")}>
                        {t("steamCatalog.installModal.customFolder")}
                      </p>
                      <p
                        className={cn(
                          "truncate text-foreground/90 font-medium",
                          consoleMode ? "text-base" : "text-sm"
                        )}>
                        {customPath}
                      </p>
                    </div>
                    {!hasEnoughSpace && (
                      <AlertCircle size={consoleMode ? 22 : 18} className="text-warning animate-pulse" />
                    )}
                  </div>
                )}

                <ScrollShadow className={cn("space-y-2", consoleMode ? "max-h-96" : "max-h-75")}>
                  {disks.map((disk) => {
                    const isSelected = selectedDisk === disk.mountPoint && !customPath;
                    const lowSpace = disk.availableSpace < gameSizeBytes;

                    return (
                      <div
                        key={disk.mountPoint}
                        onClick={() => {
                          setSelectedDisk(disk.mountPoint);
                          setCustomPath(null);
                        }}
                        className={cn(
                          "group cursor-pointer rounded-xl border transition-all duration-200",
                          consoleMode ? "p-5" : "p-4",
                          isSelected
                            ? "bg-primary border-primary shadow-lg shadow-primary/20"
                            : "bg-content2 border-divider hover:bg-content3 hover:border-default-300"
                        )}>
                        <div className="flex items-center gap-4">
                          <div
                            className={cn(
                              "rounded-lg transition-colors",
                              consoleMode ? "p-3" : "p-2",
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-default-100 text-default-600 group-hover:text-foreground"
                            )}>
                            <HardDrive size={consoleMode ? 24 : 20} />
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <span
                                className={cn(
                                  "font-bold",
                                  consoleMode ? "text-base" : "text-sm",
                                  isSelected ? "text-white" : "text-foreground"
                                )}>
                                {disk.name || t("steamCatalog.installModal.mountPointDefaultLabel")} (
                                {disk.mountPoint.replace(/\\/g, "/")})
                                {isSelected && (
                                  <span className="ml-1 opacity-70 font-normal">
                                    / {DEFAULT_DOWNLOAD_SUBFOLDER} / {sanitizeFolderName(gameName)}
                                  </span>
                                )}
                              </span>
                              <span
                                className={cn(
                                  "font-bold uppercase tracking-wider",
                                  consoleMode ? "text-xs" : "text-[10px]",
                                  isSelected ? "text-white/80" : "text-default-400"
                                )}>
                                {t("steamCatalog.installModal.freeSpace", { size: formatBytes(disk.availableSpace) })}
                              </span>
                            </div>

                            {/* Warning if low space */}
                            {lowSpace && (
                              <div
                                className={cn(
                                  "flex items-center gap-1.5 mt-1",
                                  isSelected ? "text-white" : "text-warning",
                                  consoleMode ? "text-xs" : "text-[10px]"
                                )}>
                                <AlertCircle size={consoleMode ? 14 : 12} />
                                <span className="font-bold">{t("steamCatalog.installModal.insufficientSpace")}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </ScrollShadow>

                {peerOffers.length > 0 && selectedPeer ? (
                  <div
                    className={cn(
                      "rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning-700 dark:text-warning",
                      consoleMode ? "text-sm p-4" : "text-xs"
                    )}>
                    <p className="font-semibold uppercase tracking-wide text-[10px] text-warning">
                      {t("steamCatalog.installModal.note")}
                    </p>
                    <p className="mt-1 leading-relaxed">
                      {peerReachable
                        ? t("steamCatalog.installModal.peerTransferLanReachable", {
                            device: selectedPeer.deviceName.toUpperCase(),
                          })
                        : t("steamCatalog.installModal.peerTransferLanUnreachable", {
                            device: selectedPeer.deviceName.toUpperCase(),
                          })}
                    </p>
                    {peerOffers.length > 1 && onSelectPeerDevice ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {peerOffers.map((offer) => (
                          <Button
                            key={offer.deviceId}
                            size={consoleMode ? "md" : "sm"}
                            variant={offer.deviceId === selectedPeer.deviceId ? "solid" : "flat"}
                            color={offer.deviceId === selectedPeer.deviceId ? "warning" : "default"}
                            onPress={() => onSelectPeerDevice(offer.deviceId)}
                            className={consoleMode ? "h-10 text-sm font-semibold rounded-xl px-4" : ""}>
                            {offer.deviceName}
                            {offer.reachableOnLan ? " (LAN)" : ""}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={onClose}
                className={cn(
                  "bg-default-100 hover:bg-default-200 text-default-700 font-semibold",
                  consoleMode ? "h-12 text-base rounded-xl px-6" : ""
                )}>
                {t("common.cancel")}
              </Button>

              <Button
                color="primary"
                isDisabled={!effectivePath || !hasEnoughSpace || (peerReachable && !onConfirmPeer)}
                onPress={handleInstall}
                className={cn(
                  "font-bold shadow-lg shadow-primary/20",
                  consoleMode ? "h-12 text-base rounded-xl px-8" : "px-8"
                )}>
                {peerReachable && selectedPeer
                  ? t("steamCatalog.installModal.bringFromDevice", { device: selectedPeer.deviceName })
                  : t("steamCatalog.grid.install")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
