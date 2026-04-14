import { useCallback, useEffect, useMemo, useRef } from "react";
import { DropdownItem, DropdownMenu } from "@heroui/react";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  FolderOpen,
  History,
  Link2,
  Magnet,
  Pencil,
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
    <DropdownMenu aria-label={`Acciones para ${game.id}`} onAction={handleAction} disabledKeys={disabledKeys}>
      <DropdownItem
        key="edit"
        className={isGameActionItemHidden("edit", props) ? "hidden" : ""}
        startContent={<Pencil size={16} />}>
        Editar juego
      </DropdownItem>

      <DropdownItem
        key="torrent"
        className={isGameActionItemHidden("torrent", props) ? "hidden" : ""}
        startContent={<Magnet size={16} />}>
        Torrent
      </DropdownItem>

      <DropdownItem
        key="source"
        className={!game.sourceUrl ? "hidden" : "text-primary"}
        startContent={<ExternalLink size={16} />}>
        Ir a la web del juego
      </DropdownItem>

      <DropdownItem
        key="folder"
        className={isGameActionItemHidden("folder", props) ? "hidden" : ""}
        startContent={<FolderOpen size={16} />}>
        {folderLabel}
      </DropdownItem>

      <DropdownItem
        key="download"
        className={isGameActionItemHidden("download", props) ? "hidden" : ""}
        startContent={
          props.isDownloading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <CloudDownload size={16} />
          )
        }>
        Descargar de la nube
      </DropdownItem>

      <DropdownItem
        key="sync"
        className={isGameActionItemHidden("sync", props) ? "hidden" : ""}
        startContent={<CloudUpload size={16} />}>
        Subir a la nube
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
        {props.isUploadTooLarge ? "Empaquetar y subir (obligatorio)" : "Empaquetar y subir"}
      </DropdownItem>

      <DropdownItem
        key="restore"
        className={isGameActionItemHidden("restore", props) ? "hidden" : ""}
        startContent={<History size={16} />}>
        Restaurar backup
      </DropdownItem>

      <DropdownItem
        key="share"
        className={isGameActionItemHidden("share", props) ? "hidden" : ""}
        startContent={<Link2 size={16} />}>
        Compartir link
      </DropdownItem>

      <DropdownItem
        key="remove"
        className={isGameActionItemHidden("remove", props) ? "hidden" : "text-danger"}
        color="danger"
        startContent={<Trash2 size={16} />}>
        Eliminar juego
      </DropdownItem>
    </DropdownMenu>
  );
}
