import { useCallback, useEffect, useMemo, useRef } from "react";
import { DropdownItem, DropdownMenu, DropdownSection } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  Film,
  FolderOpen,
  Link2,
  Magnet,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { GameActionsMenuModelProps } from "@features/games/game-actions/gameActionMenuModel";
import {
  getFolderMenuLabel,
  getGameActionsDisabledKeys,
  isGameActionItemHidden,
  runGameAction,
} from "@features/games/game-actions/gameActionMenuModel";

const sectionClassNames = {
  base: "mb-0.5 last:mb-0",
  heading: "text-[10px] font-bold uppercase tracking-wider text-default-400 pl-1 mb-1",
  divider: "my-1 bg-default-100/70",
};

export function GameActionsDropdownMenu(props: GameActionsMenuModelProps) {
  const { t } = useTranslation();
  const { game } = props;
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const handleAction = useCallback(
    async (key: React.Key) => {
      await runGameAction(String(key), game, propsRef.current);
    },
    [game]
  );

  const disabledKeys = useMemo(
    () => getGameActionsDisabledKeys(props),
    [props.isDownloading, props.isSyncing, props.isFullBackupUploading, props.isGameRunning, props.isUploadingClip]
  );

  const folderLabel = getFolderMenuLabel(props.surface);

  const showEdit = !isGameActionItemHidden("edit", props);
  const showFolder = !isGameActionItemHidden("folder", props);
  const showRefreshSteam = !isGameActionItemHidden("refreshDetails", props);
  const showSource = !isGameActionItemHidden("source", props);

  const showRecover = !isGameActionItemHidden("recoverFromCloud", props);
  const showSync = !isGameActionItemHidden("sync", props);
  const showFullBackup = !isGameActionItemHidden("fullBackup", props);

  const showShare = !isGameActionItemHidden("share", props);
  const showTorrent = !isGameActionItemHidden("torrent", props);

  const showUploadClip = !isGameActionItemHidden("uploadClip", props);
  const showClips = !isGameActionItemHidden("clips", props);

  const showRemove = !isGameActionItemHidden("remove", props);

  const hasGeneralItems = showEdit || showFolder || showRefreshSteam || showSource;
  const hasSavesItems = showRecover || showSync || showFullBackup;
  const hasShareItems = showShare || showTorrent;
  const hasClipsItems = showUploadClip || showClips;
  const hasDangerItems = showRemove;

  return (
    <DropdownMenu
      aria-label={t("library.actionsMenu.ariaLabel", { gameId: game.id })}
      variant="flat"
      className="min-w-62 p-1.5"
      onAction={handleAction}
      disabledKeys={disabledKeys}>
      {hasGeneralItems ? (
        <DropdownSection
          aria-label="General"
          showDivider={hasSavesItems || hasShareItems || hasClipsItems || hasDangerItems}
          classNames={sectionClassNames}>
          {showEdit ? (
            <DropdownItem key="edit" startContent={<Pencil size={15} />}>
              {t("library.actionsMenu.edit")}
            </DropdownItem>
          ) : null}

          {showFolder ? (
            <DropdownItem key="folder" startContent={<FolderOpen size={15} />}>
              {folderLabel}
            </DropdownItem>
          ) : null}

          {showRefreshSteam ? (
            <DropdownItem key="refreshDetails" startContent={<RefreshCw size={15} />}>
              {t("library.actionsMenu.refreshSteam")}
            </DropdownItem>
          ) : null}

          {showSource ? (
            <DropdownItem
              key="source"
              className="text-primary"
              startContent={<ExternalLink size={15} className="text-primary" />}>
              {t("library.actionsMenu.openSourceUrl")}
            </DropdownItem>
          ) : null}
        </DropdownSection>
      ) : null}

      {hasSavesItems ? (
        <DropdownSection
          title={t("library.actionsMenu.sections.saves", "Guardados")}
          showDivider={hasShareItems || hasClipsItems || hasDangerItems}
          classNames={sectionClassNames}>
          {showRecover ? (
            <DropdownItem
              key="recoverFromCloud"
              startContent={
                props.isDownloading || props.isSyncing || props.isFullBackupUploading ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <CloudDownload size={15} />
                )
              }>
              {t("library.actionsMenu.recoverSaves")}
            </DropdownItem>
          ) : null}

          {showSync ? (
            <DropdownItem key="sync" startContent={<CloudUpload size={15} />}>
              {t("library.actionsMenu.uploadToCloud")}
            </DropdownItem>
          ) : null}

          {showFullBackup ? (
            <DropdownItem
              key="fullBackup"
              className={props.isUploadTooLarge ? "text-warning" : ""}
              startContent={
                props.isFullBackupUploading ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Archive size={15} />
                )
              }>
              {props.isUploadTooLarge
                ? t("library.actionsMenu.packageUploadRequired")
                : t("library.actionsMenu.packageUpload")}
            </DropdownItem>
          ) : null}
        </DropdownSection>
      ) : null}

      {hasShareItems ? (
        <DropdownSection
          title={t("library.actionsMenu.sections.share", "Compartir")}
          showDivider={hasClipsItems || hasDangerItems}
          classNames={sectionClassNames}>
          {showShare ? (
            <DropdownItem key="share" startContent={<Link2 size={15} />}>
              {t("library.actionsMenu.shareLink")}
            </DropdownItem>
          ) : null}

          {showTorrent ? (
            <DropdownItem key="torrent" startContent={<Magnet size={15} />}>
              {t("library.actionsMenu.torrent")}
            </DropdownItem>
          ) : null}
        </DropdownSection>
      ) : null}

      {hasClipsItems ? (
        <DropdownSection
          title={t("library.actionsMenu.sections.clips", "Clips")}
          showDivider={hasDangerItems}
          classNames={sectionClassNames}>
          {showUploadClip ? (
            <DropdownItem
              key="uploadClip"
              startContent={
                props.isUploadingClip ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Film size={15} />
                )
              }>
              {t("library.actionsMenu.uploadClip")}
            </DropdownItem>
          ) : null}

          {showClips ? (
            <DropdownItem key="clips" startContent={<Film size={15} />}>
              {t("library.actionsMenu.viewClips")}
            </DropdownItem>
          ) : null}
        </DropdownSection>
      ) : null}

      {hasDangerItems ? (
        <DropdownSection aria-label="Danger" classNames={sectionClassNames}>
          {showRemove ? (
            <DropdownItem key="remove" className="text-danger" color="danger" startContent={<Trash2 size={15} />}>
              {t("library.actionsMenu.remove")}
            </DropdownItem>
          ) : null}
        </DropdownSection>
      ) : null}
    </DropdownMenu>
  );
}
