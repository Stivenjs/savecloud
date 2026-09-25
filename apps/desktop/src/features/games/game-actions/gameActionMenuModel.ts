import { openUrl } from "@tauri-apps/plugin-opener";
import i18n from "@lib/i18n";
import type { ConfiguredGame } from "@app-types/config";

export type GameActionsMenuSurface = "list" | "detail";

/** Props compartidas para el menú de acciones (lista y detalle). */
export interface GameActionsMenuModelProps {
  surface: GameActionsMenuSurface;
  game: ConfiguredGame;
  isGameRunning?: boolean;
  isUploadTooLarge?: boolean;
  isSyncing?: boolean;
  isDownloading?: boolean;
  isFullBackupUploading?: boolean;
  isUploadingClip?: boolean;
  onEdit?: (game: ConfiguredGame) => void;
  onTorrent?: (game: ConfiguredGame) => void;
  onOpenFolder?: (game: ConfiguredGame) => void;
  onSync?: (game: ConfiguredGame) => void;
  /** Unifica descarga desde la nube + restauraciones (abre modal con todas las opciones). */
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
  onUploadClip?: (game: ConfiguredGame) => void;
  onOpenClips?: (game: ConfiguredGame) => void;
  onRemove?: (game: ConfiguredGame) => void;
  onRefreshDetails?: (game: ConfiguredGame) => void;
}

export function getGameActionsDisabledKeys(p: GameActionsMenuModelProps): string[] {
  const { isDownloading, isSyncing, isFullBackupUploading, isUploadingClip, isGameRunning } = p;
  if (isDownloading || isSyncing || isFullBackupUploading || isUploadingClip) {
    return ["folder", "recoverFromCloud", "sync", "fullBackup", "uploadClip"];
  }
  if (isGameRunning) {
    return ["recoverFromCloud", "sync", "fullBackup"];
  }
  return [];
}

export async function runGameAction(key: string, game: ConfiguredGame, p: GameActionsMenuModelProps): Promise<void> {
  switch (key) {
    case "edit":
      p.onEdit?.(game);
      break;
    case "torrent":
      p.onTorrent?.(game);
      break;
    case "folder":
      p.onOpenFolder?.(game);
      break;
    case "recoverFromCloud":
      p.onRecoverFromCloud?.(game);
      break;
    case "share":
      p.onShare?.(game);
      break;
    case "uploadClip":
      p.onUploadClip?.(game);
      break;
    case "clips":
      p.onOpenClips?.(game);
      break;
    case "fullBackup":
      p.onFullBackupUpload?.(game);
      break;
    case "remove":
      p.onRemove?.(game);
      break;
    case "refreshDetails":
      p.onRefreshDetails?.(game);
      break;
    case "source":
      if (game.sourceUrl) await openUrl(game.sourceUrl);
      break;
    case "sync":
      if (!p.isUploadTooLarge) p.onSync?.(game);
      break;
    default:
      break;
  }
}

export function isGameActionItemHidden(
  item:
    | "edit"
    | "torrent"
    | "source"
    | "folder"
    | "recoverFromCloud"
    | "sync"
    | "fullBackup"
    | "share"
    | "uploadClip"
    | "clips"
    | "remove"
    | "refreshDetails",
  p: GameActionsMenuModelProps
): boolean {
  const { game, isUploadTooLarge } = p;
  switch (item) {
    case "edit":
      return !p.onEdit;
    case "torrent":
      return !p.onTorrent;
    case "source":
      return !game.sourceUrl;
    case "folder":
      return !p.onOpenFolder;
    case "recoverFromCloud":
      return !p.onRecoverFromCloud;
    case "sync":
      return !p.onSync || !!isUploadTooLarge;
    case "fullBackup":
      return !p.onFullBackupUpload;
    case "share":
      return !p.onShare;
    case "uploadClip":
      return !p.onUploadClip;
    case "clips":
      return !p.onOpenClips;
    case "remove":
      return !p.onRemove;
    case "refreshDetails":
      return !game.steamAppId || !p.onRefreshDetails;
    default:
      return true;
  }
}

/** Etiqueta de carpeta según superficie (misma acción, distinto copy). */
export function getFolderMenuLabel(surface: GameActionsMenuSurface): string {
  return surface === "list"
    ? i18n.t("library.actionsMenu.openSaveFolderList")
    : i18n.t("library.actionsMenu.openSaveFolderDetail");
}
