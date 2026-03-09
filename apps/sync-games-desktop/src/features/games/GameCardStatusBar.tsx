import {
  AlertTriangle,
  Archive,
  Check,
  CloudDownload,
  CloudUpload,
} from "lucide-react";

export type SyncStatusType =
  | "pending_upload"
  | "pending_download"
  | "in_sync"
  | null;

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
export function GameCardStatusBar({
  isGameRunning,
  syncStatus,
  cloudBackupCount = 0,
}: GameCardStatusBarProps) {
  const parts: { icon: React.ReactNode; text: string; title: string }[] = [];

  if (isGameRunning) {
    parts.push({
      icon: <AlertTriangle size={12} className="shrink-0" />,
      text: "En ejecución",
      title: "Cierra el juego antes de sincronizar.",
    });
  }

  if (syncStatus === "pending_upload") {
    parts.push({
      icon: <CloudUpload size={12} className="shrink-0" />,
      text: "Pend. subir",
      title: "Hay guardados locales sin subir.",
    });
  } else if (syncStatus === "pending_download") {
    parts.push({
      icon: <CloudDownload size={12} className="shrink-0" />,
      text: "Pend. descargar",
      title: "Hay guardados en la nube más recientes.",
    });
  } else if (syncStatus === "in_sync") {
    parts.push({
      icon: <Check size={12} className="shrink-0" />,
      text: "Sincronizado",
      title: "Sincronizado con la nube.",
    });
  }

  if (cloudBackupCount > 0) {
    parts.push({
      icon: <Archive size={12} className="shrink-0" />,
      text: `${cloudBackupCount} empaquetado${
        cloudBackupCount !== 1 ? "s" : ""
      }`,
      title:
        "Backups completos en la nube. Restaurar desde backup → En la nube.",
    });
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
      role="status"
    >
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
