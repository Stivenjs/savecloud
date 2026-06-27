import { useMemo } from "react";
import { formatBytes } from "@utils/format";

export interface GameCardSyncBadgeProps {
  syncStatus?: "pending_upload" | "pending_download" | "in_sync" | null;
  isGameRunning?: boolean;
  cloudBackupCount?: number;
  localSizeBytes?: number | null;
}

export function GameCardSyncBadge({
  syncStatus,
  isGameRunning,
  cloudBackupCount = 0,
  localSizeBytes,
}: GameCardSyncBadgeProps) {
  const badge = useMemo(() => {
    let badgeText = "";
    let badgeColorClass = "";

    if (isGameRunning) {
      badgeText = "JUGANDO";
      badgeColorClass =
        "bg-danger text-danger-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide animate-pulse";
    } else if (syncStatus === "pending_upload") {
      badgeText = "MODIFICADO";
      badgeColorClass =
        "bg-warning text-warning-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (syncStatus === "pending_download") {
      badgeText = "NUBE NUEVA";
      badgeColorClass =
        "bg-primary text-primary-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (syncStatus === "in_sync") {
      badgeText = "AL DÍA";
      badgeColorClass =
        "bg-success text-success-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (cloudBackupCount > 0) {
      badgeText = "RESPALDOS";
      badgeColorClass =
        "bg-secondary text-secondary-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    }

    if (!badgeText && localSizeBytes == null) return null;

    return (
      <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-zinc-950/85 backdrop-blur-md rounded-[6px] p-0.5 pr-2 border border-white/10 shadow-lg select-none">
        {badgeText && <span className={badgeColorClass}>{badgeText}</span>}
        {localSizeBytes != null && (
          <span className="text-zinc-200 font-mono text-[9.5px] font-bold tracking-tight">
            {formatBytes(localSizeBytes)}
            {cloudBackupCount > 0 ? ` (${cloudBackupCount})` : ""}
          </span>
        )}
      </div>
    );
  }, [isGameRunning, syncStatus, cloudBackupCount, localSizeBytes]);

  return badge;
}
