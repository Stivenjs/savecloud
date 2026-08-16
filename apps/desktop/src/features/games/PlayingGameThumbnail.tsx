import { useMemo, useState, useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { useConfig } from "@hooks/useConfig";
import {
  extractAppIdFromId,
  extractAppIdFromFolderName,
  isSteamAppId,
  getSteamThumbnailCandidates,
  formatGameDisplayName,
} from "@utils/gameImage";

export interface PlayingGameThumbnailProps {
  gameId?: string | null;
  gameName?: string | null;
  imageUrl?: string | null;
  steamAppId?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showGlow?: boolean;
}

const SIZE_CLASSES = {
  xs: "h-5 w-8 rounded-[4px]",
  sm: "h-7 w-12 rounded-[5px]",
  md: "h-9 w-16 rounded-[6px]",
  lg: "h-12 w-20 rounded-[8px]",
} as const;

const ICON_SIZES = {
  xs: 11,
  sm: 14,
  md: 17,
  lg: 22,
} as const;

export function PlayingGameThumbnail({
  gameId,
  gameName,
  imageUrl,
  steamAppId,
  size = "sm",
  className = "",
  showGlow = false,
}: PlayingGameThumbnailProps) {
  const { config } = useConfig();
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  const configuredGame = useMemo(() => {
    if (!config?.games || !config.games.length) return null;
    const cleanId = gameId?.trim().toLowerCase();
    const cleanName = gameName?.trim().toLowerCase();
    const normId = cleanId ? cleanId.replace(/[-_ ]/g, "") : "";
    const normName = cleanName ? cleanName.replace(/[-_ ]/g, "") : "";

    return (
      config.games.find((g) => {
        const gid = g.id.toLowerCase();
        const gDisplayName = formatGameDisplayName(g.id).toLowerCase();
        const gNormId = gid.replace(/[-_ ]/g, "");
        const gNormName = gDisplayName.replace(/[-_ ]/g, "");

        return (
          (cleanId && (gid === cleanId || gDisplayName === cleanId)) ||
          (cleanName && (gid === cleanName || gDisplayName === cleanName)) ||
          (normId && (gNormId === normId || gNormName === normId)) ||
          (normName && (gNormId === normName || gNormName === normName))
        );
      }) ?? null
    );
  }, [config?.games, gameId, gameName]);

  const resolvedSteamAppId = useMemo(() => {
    if (steamAppId?.trim()) return steamAppId.trim();
    if (configuredGame?.steamAppId?.trim()) return configuredGame.steamAppId.trim();

    if (gameId?.trim()) {
      const fromId = extractAppIdFromId(gameId);
      if (fromId) return fromId;
      const fromFolder = extractAppIdFromFolderName(gameId);
      if (fromFolder) return fromFolder;
      if (isSteamAppId(gameId)) return gameId.trim();
    }

    if (gameName?.trim()) {
      const fromName = extractAppIdFromFolderName(gameName);
      if (fromName) return fromName;
    }

    return null;
  }, [steamAppId, configuredGame, gameId, gameName]);

  const candidateUrls = useMemo(() => {
    const urls: string[] = [];

    const customCover = imageUrl?.trim() || configuredGame?.imageUrl?.trim();
    if (customCover) {
      urls.push(customCover);
    }

    if (resolvedSteamAppId) {
      urls.push(...getSteamThumbnailCandidates(resolvedSteamAppId));
    }

    return [...new Set(urls.filter(Boolean))];
  }, [imageUrl, configuredGame?.imageUrl, resolvedSteamAppId]);

  useEffect(() => {
    setCandidateIndex(0);
    setHasError(false);
  }, [candidateUrls.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSrc = candidateUrls[candidateIndex];

  const handleImgError = () => {
    if (candidateIndex < candidateUrls.length - 1) {
      setCandidateIndex((i) => i + 1);
    } else {
      setHasError(true);
    }
  };

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;
  const iconSize = ICON_SIZES[size] || ICON_SIZES.sm;

  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-white/15 bg-zinc-900/90 shadow-xs backdrop-blur-xs select-none ${sizeClass} ${
        showGlow ? "shadow-[0_0_12px_rgba(34,197,94,0.35)] ring-1 ring-emerald-500/40" : ""
      } ${className}`}>
      {currentSrc && !hasError ? (
        <img
          src={currentSrc}
          alt={gameName || gameId || "Game"}
          className="size-full object-cover transition-opacity duration-300"
          loading="eager"
          decoding="async"
          onError={handleImgError}
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-linear-to-br from-zinc-800 to-zinc-950 text-emerald-400/90">
          <Gamepad2 size={iconSize} className="drop-shadow-xs" />
        </div>
      )}
    </div>
  );
}
