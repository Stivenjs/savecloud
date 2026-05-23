import { useState, useMemo } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, ScrollShadow, cn } from "@heroui/react";
import { HardDrive, AlertCircle, FolderOpen, Globe, Share2 } from "lucide-react";
import {
  downloadKindDescription,
  downloadKindLabel,
  resolveDefaultDownloadKind,
  type EffectiveDownloadKind,
} from "@utils/sourceMatch";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import { useDisks } from "@hooks/useDisks";
import { formatBytes } from "@utils/format";
import { open } from "@tauri-apps/plugin-dialog";
import { parseSize } from "@utils/size";
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
  onConfirm: (path: string) => void;
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
  onConfirm,
}: InstallModalProps) {
  const { disks } = useDisks();
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState<string | null>(null);

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
      title: `Seleccionar carpeta para ${gameName}`,
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

  const handleInstall = () => {
    if (effectivePath) {
      onConfirm(effectivePath);
      onOpenChange(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="2xl"
      classNames={{
        base: "bg-content1 text-foreground border border-divider",
        header: "border-b border-divider pb-4",
        footer: "border-t border-divider pt-4",
      }}
      backdrop="blur">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold tracking-tight">Instalar</h2>
            </ModalHeader>
            <ModalBody className="py-6">
              {/* Game Info Header */}
              <div className="flex gap-4 items-center bg-content2 p-4 rounded-xl border border-divider mb-6">
                <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-default-100">
                  <InstallModalGameCover game={game} alt={gameName} mediaBySteamAppId={mediaBySteamAppId} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold truncate">{gameName}</h3>
                  <p className="text-default-500 text-sm font-medium">
                    Tamaño necesario: <span className="text-foreground">{gameSizeStr || "Desconocido"}</span>
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
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-default-400">Instalar en:</h4>
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<FolderOpen size={14} />}
                    className="text-primary h-7 min-w-unit-0 px-2"
                    onPress={handleCustomFolder}>
                    Elegir otra carpeta
                  </Button>
                </div>

                {customPath && (
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-3">
                    <div className="p-2 bg-primary/20 rounded-md text-primary">
                      <FolderOpen size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-primary uppercase">Carpeta personalizada</p>
                      <p className="text-sm truncate text-foreground/90">{customPath}</p>
                    </div>
                    {!hasEnoughSpace && <AlertCircle size={18} className="text-warning animate-pulse" />}
                  </div>
                )}

                <ScrollShadow className="max-h-[300px] space-y-2">
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
                          "group cursor-pointer p-4 rounded-xl border transition-all duration-200",
                          isSelected
                            ? "bg-primary border-primary shadow-lg shadow-primary/20"
                            : "bg-content2 border-divider hover:bg-content3 hover:border-default-300"
                        )}>
                        <div className="flex items-center gap-4">
                          <div
                            className={cn(
                              "p-2 rounded-lg transition-colors",
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-default-100 text-default-600 group-hover:text-foreground"
                            )}>
                            <HardDrive size={20} />
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <span className={cn("font-bold text-sm", isSelected ? "text-white" : "text-foreground")}>
                                {disk.name || "Unidad local"} ({disk.mountPoint.replace(/\\/g, "/")})
                                {isSelected && (
                                  <span className="ml-1 opacity-70 font-normal">
                                    / {DEFAULT_DOWNLOAD_SUBFOLDER} / {sanitizeFolderName(gameName)}
                                  </span>
                                )}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] font-bold uppercase tracking-wider",
                                  isSelected ? "text-white/80" : "text-default-400"
                                )}>
                                Espacio Libre: {formatBytes(disk.availableSpace)}
                              </span>
                            </div>

                            {/* Warning if low space */}
                            {lowSpace && (
                              <div
                                className={cn(
                                  "flex items-center gap-1.5 mt-1",
                                  isSelected ? "text-white" : "text-warning"
                                )}>
                                <AlertCircle size={12} />
                                <span className="text-[10px] font-bold">ESPACIO INSUFICIENTE</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </ScrollShadow>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose} className="bg-default-100 hover:bg-default-200 text-default-700">
                Cancelar
              </Button>

              <Button
                color="primary"
                isDisabled={!effectivePath || !hasEnoughSpace}
                onPress={handleInstall}
                className="font-bold px-8 shadow-lg shadow-primary/20">
                Instalar
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
