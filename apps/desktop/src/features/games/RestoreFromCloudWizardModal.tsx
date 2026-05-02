import { useCallback, useEffect, useState, startTransition } from "react";
import { Button, Code, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { CloudDownload, FolderOpen, ScanSearch } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";
import { toastError, toastSuccess } from "@utils/toast";

interface RestoreFromCloudWizardModalProps {
  gameId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Persiste carpeta como primer path del juego y refresca configuración (add_game). */
  onLinkFolder: (folderPath: string) => Promise<void>;
  /** Abre ScanModal con el mismo identificador fijado. */
  onRequestScanAssist: () => void;
  /** Prefetch de conflicto / preview igual que desde la lista. */
  onDownloadNow: () => void;
}

export function RestoreFromCloudWizardModal({
  gameId,
  isOpen,
  onClose,
  onLinkFolder,
  onRequestScanAssist,
  onDownloadNow,
}: RestoreFromCloudWizardModalProps) {
  const [phase, setPhase] = useState<"pick" | "linked">("pick");
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhase("pick");
      setLinking(false);
    }
  }, [isOpen, gameId]);

  const handleBrowseAndLink = useCallback(async () => {
    setLinking(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Carpeta de guardados donde restaurar desde la nube",
      });
      if (typeof selected !== "string" || !selected.trim()) {
        return;
      }
      await onLinkFolder(selected);
      toastSuccess("Juego enlazado", `${formatGameDisplayName(gameId)} ya tiene carpeta en este equipo.`);
      setPhase("linked");
    } catch (e) {
      toastError(
        "No se pudo enlazar la carpeta",
        e instanceof Error ? e.message : typeof e === "string" ? e : "Error desconocido"
      );
    } finally {
      setLinking(false);
    }
  }, [gameId, onLinkFolder]);

  return (
    <Modal
      size="lg"
      isOpen={isOpen}
      onOpenChange={(openState) => {
        if (!openState) {
          onClose();
        }
      }}
      backdrop="blur"
      scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 border-b border-default-200 pb-4">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <CloudDownload size={22} className="text-primary shrink-0" aria-hidden />
            Traer guardados desde la nube
          </div>
          <p className="text-xs font-normal text-default-500">
            La app debe saber una carpeta local para poder escribir los archivos descargados — es distinto del escaneo
            usual de rutas en el equipo.
          </p>
        </ModalHeader>

        <ModalBody className="gap-5 py-5">
          <div className="rounded-xl border border-default-200 bg-default-50/50 px-4 py-3 dark:border-default-100/15 dark:bg-default-100/10">
            <p className="text-sm font-medium text-foreground">{formatGameDisplayName(gameId)}</p>
            <Code size="sm" className="mt-2 block truncate text-[11px] text-default-600">
              {gameId}
            </Code>
          </div>

          {phase === "pick" ? (
            <div className="flex flex-col gap-4">
              <Button
                color="primary"
                startContent={
                  linking ? <Spinner color="current" size="sm" /> : <FolderOpen size={18} className="shrink-0" />
                }
                onPress={() => void handleBrowseAndLink()}
                isDisabled={linking}>
                Elegir carpeta de guardados…
              </Button>
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-default-300 px-3 py-2.5 dark:border-default-100/25">
                <ScanSearch size={18} className="mt-0.5 shrink-0 text-default-400" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-default-700 dark:text-default-300">
                    ¿No sabes cuál carpeta es?
                  </p>
                  <p className="text-[11px] leading-relaxed text-default-500">
                    Puedes usar el escaneo automático como ayuda — es el mismo flujo que al añadir juegos desde
                    búsqueda.
                  </p>
                  <Button
                    size="sm"
                    variant="flat"
                    className="mt-1 h-8 cursor-pointer text-default-700"
                    isDisabled={linking}
                    onPress={() => {
                      onRequestScanAssist();
                    }}>
                    Buscar carpeta automáticamente…
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-success-500/40 bg-success-50/30 px-4 py-3 dark:border-success-700/35 dark:bg-success-900/15">
              <p className="text-sm font-medium text-foreground">
                Este juego está enlazado a una carpeta en este equipo.
              </p>
              <p className="text-xs text-default-600 dark:text-default-400">
                Puedes descargar ahora mismo los guardados que hay en la nube o cerrar y hacerlo después desde la
                tarjeta del juego.
              </p>
              <Button
                color="primary"
                variant="solid"
                className="cursor-pointer"
                startContent={<CloudDownload size={18} />}
                onPress={() => {
                  startTransition(() => {
                    onDownloadNow();
                  });
                }}>
                Descargar ahora
              </Button>
            </div>
          )}
        </ModalBody>

        <ModalFooter className="border-t border-default-200">
          <Button variant="flat" className="cursor-pointer" onPress={onClose}>
            {phase === "linked" ? "Cerrar" : "Cancelar"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
