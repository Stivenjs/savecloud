import { useCallback, useEffect, useMemo, useRef } from "react";
import { DropdownItem, DropdownMenu } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  ExternalLink,
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
    [props.isDownloading, props.isSyncing, props.isFullBackupUploading, props.isGameRunning]
  );

  const folderLabel = getFolderMenuLabel(props.surface);

  return (
    <DropdownMenu
      aria-label={t("library.actionsMenu.ariaLabel", { gameId: game.id })}
      onAction={handleAction}
      disabledKeys={disabledKeys}>
      <DropdownItem
        key="edit"
        className={isGameActionItemHidden("edit", props) ? "hidden" : ""}
        startContent={<Pencil size={16} />}>
        {t("library.actionsMenu.edit")}
      </DropdownItem>

      <DropdownItem
        key="torrent"
        className={isGameActionItemHidden("torrent", props) ? "hidden" : ""}
        startContent={<Magnet size={16} />}>
        {t("library.actionsMenu.torrent")}
      </DropdownItem>

      <DropdownItem
        key="source"
        className={!game.sourceUrl ? "hidden" : "text-primary"}
        startContent={<ExternalLink size={16} />}>
        {t("library.actionsMenu.openSourceUrl")}
      </DropdownItem>

      <DropdownItem
        key="folder"
        className={isGameActionItemHidden("folder", props) ? "hidden" : ""}
        startContent={<FolderOpen size={16} />}>
        {folderLabel}
      </DropdownItem>

      <DropdownItem
        key="recoverFromCloud"
        className={isGameActionItemHidden("recoverFromCloud", props) ? "hidden" : ""}
        startContent={
          props.isDownloading || props.isSyncing || props.isFullBackupUploading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <CloudDownload size={16} />
          )
        }>
        {t("library.actionsMenu.recoverSaves")}
      </DropdownItem>

      <DropdownItem
        key="sync"
        className={isGameActionItemHidden("sync", props) ? "hidden" : ""}
        startContent={<CloudUpload size={16} />}>
        {t("library.actionsMenu.uploadToCloud")}
      </DropdownItem>

      <DropdownItem
        key="fullBackup"
        className={
          isGameActionItemHidden("fullBackup", props) ? "hidden" : props.isUploadTooLarge ? "text-warning" : ""
        }
        startContent={
          props.isFullBackupUploading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Archive size={16} />
          )
        }>
        {props.isUploadTooLarge
          ? t("library.actionsMenu.packageUploadRequired")
          : t("library.actionsMenu.packageUpload")}
      </DropdownItem>

      <DropdownItem
        key="share"
        className={isGameActionItemHidden("share", props) ? "hidden" : ""}
        startContent={<Link2 size={16} />}>
        {t("library.actionsMenu.shareLink")}
      </DropdownItem>

      <DropdownItem
        key="refreshDetails"
        className={isGameActionItemHidden("refreshDetails", props) ? "hidden" : ""}
        startContent={<RefreshCw size={16} />}>
        {t("library.actionsMenu.refreshSteam")}
      </DropdownItem>

      <DropdownItem
        key="remove"
        className={isGameActionItemHidden("remove", props) ? "hidden" : "text-danger"}
        color="danger"
        startContent={<Trash2 size={16} />}>
        {t("library.actionsMenu.remove")}
      </DropdownItem>
    </DropdownMenu>
  );
}
