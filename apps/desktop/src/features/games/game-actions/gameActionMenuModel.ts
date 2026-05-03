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
  /** Unifica descarga desde la nube + restauraciones (abre modal con todas las opciones). */
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
  onRemove?: (game: ConfiguredGame) => void;
}

export function getGameActionsDisabledKeys(p: GameActionsMenuModelProps): string[] {
  const { isDownloading, isSyncing, isFullBackupUploading, isGameRunning } = p;
  if (isDownloading || isSyncing || isFullBackupUploading) {
    return ["folder", "recoverFromCloud", "sync", "fullBackup"];
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
  item: "edit" | "torrent" | "source" | "folder" | "recoverFromCloud" | "sync" | "fullBackup" | "share" | "remove",
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
