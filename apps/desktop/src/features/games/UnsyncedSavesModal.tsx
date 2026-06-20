import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip, Skeleton } from "@heroui/react";
import { Archive, CloudUpload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { previewUploadBatch } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { isGameTooLargeForSync } from "@utils/packageRecommendation";
import { useMemo } from "react";

interface UnsyncedSavesModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameIds: string[];
  onUploadAll: () => void;
  onUploadGame?: (gameId: string) => void | Promise<void>;
  onFullBackupGame?: (gameId: string) => void | Promise<void>;
  isLoadingAll?: boolean;
  loadingGameId?: string | null;
}

export function UnsyncedSavesModal({
  isOpen,
  onClose,
  gameIds,
  onUploadGame,
  onFullBackupGame,
  isLoadingAll = false,
  loadingGameId = null,
}: UnsyncedSavesModalProps) {
  const { data: previewsMap = {}, isPending: isLoadingPreviews } = useQuery({
    queryKey: ["unsynced-previews-batch", gameIds],
    queryFn: () => previewUploadBatch(gameIds),
    enabled: isOpen && gameIds.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const largeGameIds = useMemo(() => {
    if (isLoadingPreviews) return new Set<string>();

    return new Set(
      gameIds.filter((gameId) => {
        const data = previewsMap[gameId];
        return data && isGameTooLargeForSync(data.fileCount, data.totalSizeBytes);
      })
    );
  }, [gameIds, previewsMap, isLoadingPreviews]);

  if (gameIds.length === 0) return null;

  const hasPerGameActions = typeof onUploadGame === "function" && typeof onFullBackupGame === "function";

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex gap-2">
          <CloudUpload size={22} />
          Guardados sin subir
        </ModalHeader>

        <ModalBody className="gap-3">
          <p className="text-default-600">
            {gameIds.length === 1
              ? `Tienes guardados nuevos en ${formatGameDisplayName(gameIds[0])}.`
              : `Tienes guardados nuevos en ${gameIds.length} juegos.`}
          </p>

          <div className="rounded-lg border border-default-200 bg-default-100/50 p-3 text-sm text-default-600">
            <p className="font-medium text-foreground">Opciones</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>
                <strong>Subir</strong>: sincroniza archivo a archivo (ideal para pocos cambios). No disponible para
                juegos grandes.
              </li>
              <li>
                <strong>Empaquetar y subir</strong>: crea un .tar con toda la carpeta y lo sube en una sola operación
                (obligatorio para juegos con muchos archivos o mucho peso).
              </li>
            </ul>
          </div>

          {hasPerGameActions && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Por juego</p>
              <ul className="flex flex-col gap-1.5">
                {gameIds.map((gameId) => {
                  const busy = loadingGameId === gameId;
                  const previewPending = isLoadingPreviews;
                  const isLarge = largeGameIds.has(gameId);

                  return (
                    <li
                      key={gameId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-default-200 bg-default-50/50 px-3 py-2">
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {formatGameDisplayName(gameId)}
                      </span>

                      <span className="flex shrink-0 gap-2">
                        {/* Skeleton mientras la preview está en vuelo */}
                        {previewPending ? (
                          <>
                            <Skeleton className="h-8 w-16 rounded-lg" />
                            <Skeleton className="h-8 w-32 rounded-lg" />
                          </>
                        ) : isLarge ? (
                          <>
                            <Tooltip content="Este juego es demasiado grande. Usa Empaquetar y subir." placement="top">
                              <span className="inline-flex">
                                <Button size="sm" variant="flat" isDisabled startContent={<CloudUpload size={14} />}>
                                  Subir
                                </Button>
                              </span>
                            </Tooltip>
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              startContent={!busy ? <Archive size={14} /> : undefined}
                              onPress={() => onFullBackupGame?.(gameId)}
                              isLoading={busy}
                              isDisabled={isLoadingAll}>
                              Empaquetar y subir
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="flat"
                              startContent={!busy ? <CloudUpload size={14} /> : undefined}
                              onPress={() => onUploadGame?.(gameId)}
                              isLoading={busy}
                              isDisabled={isLoadingAll}>
                              Subir
                            </Button>
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              startContent={!busy ? <Archive size={14} /> : undefined}
                              onPress={() => onFullBackupGame?.(gameId)}
                              isLoading={busy}
                              isDisabled={isLoadingAll}>
                              Empaquetar y subir
                            </Button>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {/* Solo muestra el aviso de "grandes" cuando ya terminaron de cargar */}
          {!isLoadingPreviews && largeGameIds.size > 0 && (
            <p className="mr-auto text-sm text-warning">
              {largeGameIds.size === gameIds.length
                ? "Todos son demasiado grandes. Usa Empaquetar y subir."
                : `${largeGameIds.size} grande${largeGameIds.size !== 1 ? "s" : ""}: Empaquetar y subir.`}
            </p>
          )}
          <Button variant="light" onPress={onClose} isDisabled={isLoadingAll}>
            Omitir
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
