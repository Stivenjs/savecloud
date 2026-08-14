import { Archive, Check, CloudDownload, CloudUpload } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SyncStatusType = "pending_upload" | "pending_download" | "in_sync" | null;

interface GameCardStatusBarProps {
  /** Juego en ejecución (muestra advertencia). */
  isGameRunning?: boolean;
  /** Estado de sincronización con la nube. */
  syncStatus?: SyncStatusType;
  /** Número de backups empaquetados en la nube (se muestra si > 0). */
  cloudBackupCount?: number;
}

/**
 * Barra de estado compacta para la tarjeta de juego.
 * Se muestra en el footer para no tapar la portada; una sola línea con iconos y texto breve.
 */
export function GameCardStatusBar({ isGameRunning, syncStatus, cloudBackupCount = 0 }: GameCardStatusBarProps) {
  const { t } = useTranslation();
  const parts: { icon: React.ReactNode; text: string; title: string }[] = [];

  if (isGameRunning) {
    parts.push({
      icon: (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      ),
      text: t("library.statusBar.running"),
      title: t("library.statusBar.runningTitle"),
    });
  }

  if (syncStatus === "pending_upload") {
    parts.push({
      icon: <CloudUpload size={12} className="shrink-0" />,
      text: t("library.statusBar.pendingUpload"),
      title: t("library.statusBar.pendingUploadTitle"),
    });
  } else if (syncStatus === "pending_download") {
    parts.push({
      icon: <CloudDownload size={12} className="shrink-0" />,
      text: t("library.statusBar.pendingDownload"),
      title: t("library.statusBar.pendingDownloadTitle"),
    });
  } else if (syncStatus === "in_sync") {
    parts.push({
      icon: <Check size={12} className="shrink-0" />,
      text: t("library.statusBar.inSync"),
      title: t("library.statusBar.inSyncTitle"),
    });
  }

  if (cloudBackupCount > 0) {
    parts.push({
      icon: <Archive size={12} className="shrink-0" />,
      text: t("library.statusBar.packaged", { count: cloudBackupCount }),
      title: t("library.statusBar.packagedTitle"),
    });
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
      role="status">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1" title={p.title}>
          {p.icon}
          <span>{p.text}</span>
          {i < parts.length - 1 && (
            <span className="ml-0.5 text-white/60" aria-hidden>
              ·
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
