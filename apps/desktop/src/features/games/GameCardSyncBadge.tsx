import { useMemo } from "react";
import { formatBytes } from "@utils/format";
import { useTranslation } from "react-i18next";
import { useGameSessionDuration } from "@store/GameSessionStore";

export interface GameCardSyncBadgeProps {
  gameId?: string | null;
  syncStatus?: "pending_upload" | "pending_download" | "in_sync" | null;
  isGameRunning?: boolean;
  cloudBackupCount?: number;
  localSizeBytes?: number | null;
}

export function GameCardSyncBadge({
  gameId,
  syncStatus,
  isGameRunning,
  cloudBackupCount = 0,
  localSizeBytes,
}: GameCardSyncBadgeProps) {
  const { t } = useTranslation();

  const { formattedDuration, sessionSeconds } = useGameSessionDuration({
    gameId,
    isRunning: isGameRunning,
  });

  const badge = useMemo(() => {
    let badgeText = "";
    let badgeColorClass = "";

    if (isGameRunning) {
      return (
        <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-zinc-950/85 backdrop-blur-md rounded-md p-0.5 pr-2 border border-white/10 shadow-lg select-none">
          <span className="bg-danger text-danger-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-sm tracking-wide flex items-center gap-1">
            <span className="relative flex h-1 w-1 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-foreground opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1 w-1 bg-danger-foreground"></span>
            </span>
            <span>{t("library.syncBadge.playing")}</span>
            {sessionSeconds > 0 && (
              <span className="opacity-90 font-mono text-[8px] font-bold">· {formattedDuration}</span>
            )}
          </span>
          {localSizeBytes != null && (
            <span className="text-zinc-200 font-mono text-[9.5px] font-bold tracking-tight">
              {formatBytes(localSizeBytes)}
              {cloudBackupCount > 0 ? ` (${cloudBackupCount})` : ""}
            </span>
          )}
        </div>
      );
    }

    if (syncStatus === "pending_upload") {
      badgeText = t("library.syncBadge.modified");
      badgeColorClass =
        "bg-warning text-warning-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (syncStatus === "pending_download") {
      badgeText = t("library.syncBadge.newCloud");
      badgeColorClass =
        "bg-primary text-primary-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (syncStatus === "in_sync") {
      badgeText = t("library.syncBadge.inSync");
      badgeColorClass =
        "bg-success text-success-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    } else if (cloudBackupCount > 0) {
      badgeText = t("library.syncBadge.backups");
      badgeColorClass =
        "bg-secondary text-secondary-foreground font-sans text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-[4px] tracking-wide";
    }

    if (!badgeText && localSizeBytes == null) return null;

    return (
      <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-zinc-950/85 backdrop-blur-md rounded-md p-0.5 pr-2 border border-white/10 shadow-lg select-none">
        {badgeText && <span className={badgeColorClass}>{badgeText}</span>}
        {localSizeBytes != null && (
          <span className="text-zinc-200 font-mono text-[9.5px] font-bold tracking-tight">
            {formatBytes(localSizeBytes)}
            {cloudBackupCount > 0 ? ` (${cloudBackupCount})` : ""}
          </span>
        )}
      </div>
    );
  }, [isGameRunning, sessionSeconds, formattedDuration, syncStatus, cloudBackupCount, localSizeBytes, t]);

  return badge;
}
