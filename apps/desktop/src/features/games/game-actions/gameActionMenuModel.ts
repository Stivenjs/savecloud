import { openUrl } from "@tauri-apps/plugin-opener";
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
  onEdit?: (game: ConfiguredGame) => void;
  onTorrent?: (game: ConfiguredGame) => void;
  onOpenFolder?: (game: ConfiguredGame) => void;
  onSync?: (game: ConfiguredGame) => void;
  onDownload?: (game: ConfiguredGame) => void;
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  onRestoreBackup?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
  onRemove?: (game: ConfiguredGame) => void;
}

export function getGameActionsDisabledKeys(p: GameActionsMenuModelProps): string[] {
  const { isDownloading, isSyncing, isFullBackupUploading, isGameRunning } = p;
  if (isDownloading || isSyncing || isFullBackupUploading) {
    return ["folder", "download", "sync", "fullBackup", "restore"];
  }
  if (isGameRunning) {
    return ["download", "sync", "fullBackup", "restore"];
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
    case "download":
      p.onDownload?.(game);
      break;
    case "restore":
      p.onRestoreBackup?.(game);
      break;
    case "share":
      p.onShare?.(game);
      break;
    case "fullBackup":
      p.onFullBackupUpload?.(game);
      break;
    case "remove":
      p.onRemove?.(game);
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
  item: "edit" | "torrent" | "source" | "folder" | "download" | "sync" | "fullBackup" | "restore" | "share" | "remove",
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
    case "download":
      return !p.onDownload;
    case "sync":
      return !p.onSync || !!isUploadTooLarge;
    case "fullBackup":
      return !p.onFullBackupUpload;
    case "restore":
      return !p.onRestoreBackup;
    case "share":
      return !p.onShare;
    case "remove":
      return !p.onRemove;
    default:
      return true;
  }
}

/** Etiqueta de carpeta según superficie (misma acción, distinto copy). */
export function getFolderMenuLabel(surface: GameActionsMenuSurface): string {
  return surface === "list" ? "Abrir carpeta de guardados" : "Abrir carpeta";
}
