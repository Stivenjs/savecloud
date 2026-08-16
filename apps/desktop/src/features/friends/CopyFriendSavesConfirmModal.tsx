import { Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ScrollShadow } from "@heroui/react";
import { AlertTriangle, CloudDownload, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatGameDisplayName } from "@utils/gameImage";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";

export interface CopyFriendSaveItem {
  filename: string;
  targetFilename: string;
}

interface CopyFriendSavesConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  gameDisplayName?: string;
  imageUrl?: string | null;
  steamAppId?: string | null;
  /** Archivos que se copiarán (filename → nombre final en tu nube). */
  items: CopyFriendSaveItem[];
  /** Cuántos son nuevos (sin conflicto). */
  newCount: number;
  /** Cuántos se renombrarán por conflicto. */
  conflictCount: number;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function CopyFriendSavesConfirmModal({
  isOpen,
  onClose,
  gameId,
  gameDisplayName,
  imageUrl,
  steamAppId,
  items,
  newCount,
  conflictCount,
  onConfirm,
  isLoading = false,
}: CopyFriendSavesConfirmModalProps) {
  const { t } = useTranslation();
  const displayName = gameDisplayName ?? formatGameDisplayName(gameId);
  const hasConflicts = conflictCount > 0;

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="lg" placement="center">
      <ModalContent className="overflow-hidden">
        {/* Header Hero con carátula del juego */}
        <div className="relative border-b border-default-200/60 bg-default-100/40 p-4 dark:bg-default-50/5">
          <div className="flex items-center gap-3.5">
            <PlayingGameThumbnail
              gameId={gameId}
              gameName={displayName}
              imageUrl={imageUrl}
              steamAppId={steamAppId}
              size="lg"
              className="h-13 w-22 shrink-0 rounded-lg shadow-md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CloudDownload size={14} />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {t("friends.copyConfirm.title")}
                </span>
              </div>
              <h2 className="mt-0.5 truncate text-lg font-bold text-foreground">{displayName}</h2>
              {gameId.toLowerCase() !== displayName.toLowerCase() && (
                <p className="truncate font-mono text-[11px] text-default-400">{gameId}</p>
              )}
            </div>
          </div>
        </div>

        <ModalBody className="gap-3.5 pt-4">
          <p className="text-sm text-default-600">{t("friends.copyConfirm.desc", { name: displayName })}</p>

          {hasConflicts && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 text-xs text-warning-700 dark:text-warning-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-500" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t("friends.copyConfirm.conflictWarning", { count: conflictCount })}</p>
                <p className="mt-0.5 text-[11.5px] opacity-90">
                  Tus archivos locales no se sobrescribirán; los nuevos archivos se guardarán con un sufijo seguro.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-default-200/70 bg-default-50/50 p-3 dark:bg-default-100/5">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {t("friends.copyConfirm.filesTotal", { count: items.length })}
              </span>
              <div className="flex items-center gap-1.5">
                {newCount > 0 && (
                  <Chip size="sm" color="success" variant="flat" className="h-5 text-[10.5px]">
                    {newCount} nuevos
                  </Chip>
                )}
                {conflictCount > 0 && (
                  <Chip size="sm" color="warning" variant="flat" className="h-5 text-[10.5px]">
                    {conflictCount} con sufijo
                  </Chip>
                )}
              </div>
            </div>

            <ScrollShadow className="max-h-[35vh]">
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li
                    key={`${item.filename}-${i}`}
                    className="flex flex-col gap-0.5 rounded-lg border border-default-200/50 bg-background/60 px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-2 text-foreground">
                      <FileText size={13} className="shrink-0 text-default-400" />
                      <span className="truncate font-mono text-[11px] font-medium">{item.filename}</span>
                    </span>
                    {item.targetFilename !== item.filename && (
                      <span className="ml-5 flex items-center gap-1 text-[10.5px] text-default-500">
                        <span>→</span>
                        <span className="font-mono text-warning-600 dark:text-warning-400">{item.targetFilename}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollShadow>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={handleConfirm}
            isLoading={isLoading}
            startContent={!isLoading ? <CloudDownload size={17} /> : undefined}
            className="font-semibold shadow-sm">
            {t("friends.copyConfirm.confirmButton")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
