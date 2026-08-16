import { useMemo } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGameSessionDuration } from "@store/GameSessionStore";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";
import { formatGameDisplayName } from "@utils/gameImage";

export interface PlayingStatusBadgeProps {
  gameId?: string | null;
  gameName?: string | null;
  userId?: string | null;
  imageUrl?: string | null;
  steamAppId?: string | null;
  fallbackStartedAt?: number | null;
  isRunning?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "inline" | "chip" | "card" | "banner";
  className?: string;
  showSessionTime?: boolean;
  showThumbnail?: boolean;
  showPrefix?: boolean;
}

export function PlayingStatusBadge({
  gameId,
  gameName,
  userId,
  imageUrl,
  steamAppId,
  fallbackStartedAt,
  isRunning,
  size = "sm",
  variant = "inline",
  className = "",
  showSessionTime = true,
  showThumbnail = true,
  showPrefix = false,
}: PlayingStatusBadgeProps) {
  const { t } = useTranslation();

  const { formattedDuration, sessionSeconds, isActive } = useGameSessionDuration({
    gameId,
    userId,
    fallbackStartedAt,
    isRunning,
  });

  const displayName = useMemo(() => {
    if (gameName?.trim()) return gameName.trim();
    if (gameId?.trim()) return formatGameDisplayName(gameId);
    return "";
  }, [gameName, gameId]);

  if (!displayName && !gameId) {
    return null;
  }

  if (variant === "inline") {
    return (
      <div className={`inline-flex items-center gap-2 max-w-full ${className}`}>
        {showThumbnail && (
          <PlayingGameThumbnail
            gameId={gameId}
            gameName={displayName}
            imageUrl={imageUrl}
            steamAppId={steamAppId}
            size={size}
          />
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-xs font-semibold text-emerald-400 dark:text-emerald-300">
            {showPrefix ? t("profile.drawer.playingLabel", { game: displayName }) : displayName}
          </span>
          {showSessionTime && (isActive || sessionSeconds > 0) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Clock size={10} className="shrink-0" />
              <span>{t("friends.presence.sessionTime", { time: formattedDuration })}</span>
            </span>
          )}
        </div>
      </div>
    );
  }

  if (variant === "chip") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400 shadow-xs backdrop-blur-xs ${className}`}>
        {showThumbnail && (
          <PlayingGameThumbnail
            gameId={gameId}
            gameName={displayName}
            imageUrl={imageUrl}
            steamAppId={steamAppId}
            size="xs"
          />
        )}
        <span className="max-w-35 truncate font-medium">{displayName}</span>
        {showSessionTime && (isActive || sessionSeconds > 0) && (
          <span className="font-mono text-[10px] opacity-80">· {formattedDuration}</span>
        )}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={`relative flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-linear-to-r from-emerald-950/40 via-zinc-900/60 to-zinc-900/40 p-2.5 shadow-lg backdrop-blur-md ring-1 ring-emerald-500/20 ${className}`}>
        {showThumbnail && (
          <PlayingGameThumbnail
            gameId={gameId}
            gameName={displayName}
            imageUrl={imageUrl}
            steamAppId={steamAppId}
            size={size === "xs" ? "sm" : size === "sm" ? "md" : "lg"}
            showGlow
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" />
            <p className="text-[11px] font-bold tracking-wider uppercase text-emerald-400">
              {t("friends.presence.playing")}
            </p>
          </div>
          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
          {showSessionTime && (isActive || sessionSeconds > 0) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-default-400">
              <Clock size={11} className="text-emerald-400" />
              <span>{t("friends.presence.sessionTime", { time: formattedDuration })}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 ${className}`}>
      {showThumbnail && (
        <PlayingGameThumbnail
          gameId={gameId}
          gameName={displayName}
          imageUrl={imageUrl}
          steamAppId={steamAppId}
          size="sm"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">
          {showPrefix ? t("profile.drawer.playingLabel", { game: displayName }) : displayName}
        </p>
        {showSessionTime && (isActive || sessionSeconds > 0) && (
          <p className="flex items-center gap-1 text-[11px] text-default-500">
            <Clock size={10} className="text-emerald-500" />
            <span>{t("friends.presence.sessionTime", { time: formattedDuration })}</span>
          </p>
        )}
      </div>
    </div>
  );
}
