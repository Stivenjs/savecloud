import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip, Skeleton } from "@heroui/react";
import { Archive, CloudUpload } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

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
          {t("library.unsyncedSaves.title")}
        </ModalHeader>

        <ModalBody className="gap-3">
          <p className="text-default-600">
            {gameIds.length === 1
              ? t("library.unsyncedSaves.desc_one", { gameName: formatGameDisplayName(gameIds[0]) })
              : t("library.unsyncedSaves.desc_other", { count: gameIds.length })}
          </p>

          <div className="rounded-lg border border-default-200 bg-default-100/50 p-3 text-sm text-default-600">
            <p className="font-medium text-foreground">{t("library.unsyncedSaves.optionsTitle")}</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>
                <Trans i18nKey="library.unsyncedSaves.uploadOption" components={{ strong: <strong /> }} />
              </li>
              <li>
                <Trans i18nKey="library.unsyncedSaves.packageOption" components={{ strong: <strong /> }} />
              </li>
            </ul>
          </div>

          {hasPerGameActions && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t("library.unsyncedSaves.perGame")}</p>
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
                        {previewPending ? (
                          <>
                            <Skeleton className="h-8 w-16 rounded-lg" />
                            <Skeleton className="h-8 w-32 rounded-lg" />
                          </>
                        ) : isLarge ? (
                          <>
                            <Tooltip content={t("library.unsyncedSaves.tooLargeTooltip")} placement="top">
                              <span className="inline-flex">
                                <Button size="sm" variant="flat" isDisabled startContent={<CloudUpload size={14} />}>
                                  {t("library.unsyncedSaves.upload")}
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
                              {t("library.unsyncedSaves.packageUpload")}
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
                              {t("library.unsyncedSaves.upload")}
                            </Button>
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              startContent={!busy ? <Archive size={14} /> : undefined}
                              onPress={() => onFullBackupGame?.(gameId)}
                              isLoading={busy}
                              isDisabled={isLoadingAll}>
                              {t("library.unsyncedSaves.packageUpload")}
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
          {!isLoadingPreviews && largeGameIds.size > 0 && (
            <p className="mr-auto text-sm text-warning">
              {largeGameIds.size === gameIds.length
                ? t("library.unsyncedSaves.allTooLarge")
                : t("library.unsyncedSaves.someTooLarge", { count: largeGameIds.size })}
            </p>
          )}
          <Button variant="light" onPress={onClose} isDisabled={isLoadingAll}>
            {t("library.unsyncedSaves.skip")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
