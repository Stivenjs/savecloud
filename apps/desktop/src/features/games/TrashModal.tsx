import { useMemo } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Skeleton,
} from "@heroui/react";
import { Trash2, RotateCcw, AlertTriangle, RefreshCw, Search, HardDrive, FolderArchive, Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/utils/format";
import { formatGameDisplayName } from "@/utils/gameImage";
import { useGameMedia } from "@hooks/useGameMedia";
import { CatalogCoverImage } from "@features/steam-catalog/components/CatalogCoverImage";
import { useTrashModal } from "@features/games/hooks/useTrashModal";
import type { TrashGameItem } from "@savecloud/types";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

function TrashItemCard({
  item,
  game,
  resolvedSteamAppId,
  mediaBySteamAppId,
  onRestore,
  onDeletePermanent,
  isRestoring,
  isDeleting,
  disabled,
}: {
  item: TrashGameItem;
  game: ConfiguredGame;
  resolvedSteamAppId?: string | null;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  onRestore: (gameId: string) => Promise<void>;
  onDeletePermanent: (gameId: string) => Promise<void>;
  isRestoring: boolean;
  isDeleting: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const displayName = formatGameDisplayName(item.gameId);

  const { coverCandidates, isEffectivelyLoading } = useGameMedia({
    game,
    resolvedSteamAppId: resolvedSteamAppId ?? null,
    mediaBySteamAppId,
    mediaFromBatch: true,
    orientation: "horizontal",
  });

  const daysLeft = useMemo(() => {
    try {
      const exp = new Date(item.expiresAt).getTime();
      const now = Date.now();
      const diffMs = exp - now;
      return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    } catch {
      return 30;
    }
  }, [item.expiresAt]);

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-xl border border-divider bg-content2/50 hover:bg-content2 transition-colors p-3.5 shadow-xs">
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {/* Portada usando el componente de catálogo con CDN chain y fallbacks */}
        <div className="relative h-15 w-26 shrink-0 overflow-hidden rounded-lg bg-zinc-950 border border-divider">
          {isEffectivelyLoading ? (
            <Skeleton className="absolute inset-0 z-10 size-full rounded-lg" />
          ) : (
            <CatalogCoverImage
              alt={displayName}
              candidates={coverCandidates}
              fallbackTitle={displayName}
              className="size-full object-cover object-center rounded-lg"
              fallbackClassName="flex size-full items-center justify-center p-1 bg-[#0e0f14] text-center rounded-lg text-default-400"
              showSkeleton
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-foreground truncate">{displayName}</h4>
            <span className="font-mono text-[10px] text-default-500 bg-default-100 dark:bg-default-50/10 px-1.5 py-0.5 rounded border border-default-200/60 dark:border-default-100/10 tabular-nums">
              {item.gameId}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs text-default-400">
            <span className="flex items-center gap-1">
              <HardDrive size={13} className="text-default-400" />
              <span>{formatBytes(item.totalSizeBytes)}</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <FolderArchive size={13} className="text-default-400" />
              <span>
                {item.totalFiles}{" "}
                {item.totalFiles === 1 ? t("library.trashModal.fileSingle") : t("library.trashModal.filePlural")}
              </span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-[11px]">
              <Calendar size={13} className="text-default-400" />
              <span>
                {t("library.trashModal.deletedOn")} {formatDate(item.deletedAt)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-divider w-full sm:w-auto justify-between sm:justify-end">
        <Chip
          size="sm"
          variant="flat"
          color={daysLeft <= 5 ? "danger" : "warning"}
          className="text-[11px] font-medium h-6">
          {daysLeft} {t("library.trashModal.daysLeft")}
        </Chip>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            color="primary"
            variant="solid"
            startContent={<RotateCcw size={14} />}
            onPress={() => void onRestore(item.gameId)}
            isLoading={isRestoring}
            isDisabled={disabled}>
            {t("library.trashModal.restoreButton")}
          </Button>

          <Button
            size="sm"
            variant="light"
            color="danger"
            isIconOnly
            aria-label={t("library.trashModal.deletePermanentButton")}
            onPress={() => void onDeletePermanent(item.gameId)}
            isLoading={isDeleting}
            isDisabled={disabled}>
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TrashModal({ isOpen, onClose, onRestored }: TrashModalProps) {
  const { t } = useTranslation();
  const {
    items,
    filteredItems,
    loading,
    isFetching,
    searchQuery,
    setSearchQuery,
    actionLoadingId,
    emptyLoading,
    confirmEmpty,
    setConfirmEmpty,
    totalStorageBytes,
    gamesById,
    resolvedSteamAppIds,
    mediaBySteamAppId,
    handleRestore,
    handleDeletePermanent,
    handleEmptyAll,
    refetch,
  } = useTrashModal({ isOpen, onRestored });

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="3xl"
      placement="center"
      scrollBehavior="inside"
      backdrop="blur"
      classNames={{
        base: "max-w-3xl",
        header: "border-b border-divider py-4.5 px-6 pr-14",
        body: "p-6 gap-4.5",
        footer: "border-t border-divider py-3.5 px-6",
      }}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-warning">
            {t("library.trashModal.sectionLabel")}
          </span>
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2">
            <Trash2 size={22} className="text-warning" />
            <span>{t("library.trashModal.title")}</span>
          </h2>
          <p className="text-xs text-default-500 font-normal">{t("library.trashModal.infoBanner")}</p>
        </ModalHeader>

        <ModalBody className="gap-4.5 py-4.5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <Input
              size="sm"
              variant="bordered"
              radius="lg"
              placeholder={t("library.trashModal.searchPlaceholder")}
              value={searchQuery}
              onValueChange={setSearchQuery}
              isClearable
              onClear={() => setSearchQuery("")}
              startContent={<Search size={15} className="text-default-400" />}
              className="max-w-xs"
              isDisabled={loading || items.length === 0}
            />

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-default-500 bg-content2/60 px-3 py-1.5 rounded-lg border border-divider">
                <HardDrive size={14} className="text-warning shrink-0" />
                <span>Total:</span>
                <span className="font-semibold text-foreground">{formatBytes(totalStorageBytes)}</span>
                <span className="text-default-400">
                  ({items.length}{" "}
                  {items.length === 1 ? t("library.trashModal.itemSingle") : t("library.trashModal.itemPlural")})
                </span>
              </div>

              <Button
                size="sm"
                variant="light"
                isIconOnly
                onPress={() => void refetch()}
                isLoading={isFetching}
                aria-label={t("common.refresh")}
                className="text-default-400 hover:text-default-600">
                <RefreshCw size={15} />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-default-400">
              <Spinner size="lg" color="warning" />
              <p className="text-sm font-medium">{t("library.trashModal.loading")}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-default-400">
              <div className="p-4 rounded-2xl bg-default-100 dark:bg-default-50/10 text-default-400">
                <Trash2 size={36} strokeWidth={1.5} />
              </div>
              <p className="text-base font-semibold text-foreground">{t("library.trashModal.emptyStateTitle")}</p>
              <p className="text-xs text-default-400 max-w-sm text-center leading-relaxed">
                {t("library.trashModal.emptyStateDesc")}
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-default-400">
              <Search size={32} strokeWidth={1.5} className="text-default-300 dark:text-default-600" />
              <p className="text-sm font-medium text-foreground">{t("library.trashModal.emptySearchTitle")}</p>
              <p className="text-xs text-default-400 text-center">{t("library.trashModal.emptySearchDesc")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredItems.map((item) => (
                <TrashItemCard
                  key={item.gameId}
                  item={item}
                  game={gamesById.get(item.gameId) ?? { id: item.gameId, paths: [] }}
                  resolvedSteamAppId={resolvedSteamAppIds[item.gameId]}
                  mediaBySteamAppId={mediaBySteamAppId}
                  onRestore={handleRestore}
                  onDeletePermanent={handleDeletePermanent}
                  isRestoring={actionLoadingId === `restore-${item.gameId}`}
                  isDeleting={actionLoadingId === `delete-${item.gameId}`}
                  disabled={!!actionLoadingId || emptyLoading}
                />
              ))}
            </div>
          )}
        </ModalBody>

        <ModalFooter className="flex items-center justify-between">
          <div>
            {items.length > 0 && !confirmEmpty && (
              <Button
                size="sm"
                variant="light"
                color="danger"
                onPress={() => setConfirmEmpty(true)}
                isDisabled={loading || emptyLoading || !!actionLoadingId}>
                {t("library.trashModal.emptyTrashButton")}
              </Button>
            )}

            {confirmEmpty && (
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-danger shrink-0" />
                <span className="text-xs text-danger font-medium">{t("library.trashModal.confirmEmptyWarning")}</span>
                <Button
                  size="sm"
                  color="danger"
                  variant="solid"
                  onPress={() => void handleEmptyAll()}
                  isLoading={emptyLoading}>
                  {t("library.trashModal.confirmEmptyButton")}
                </Button>
                <Button size="sm" variant="flat" onPress={() => setConfirmEmpty(false)} isDisabled={emptyLoading}>
                  {t("common.cancel")}
                </Button>
              </div>
            )}
          </div>

          <Button variant="flat" size="sm" onPress={onClose}>
            {t("common.close")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
