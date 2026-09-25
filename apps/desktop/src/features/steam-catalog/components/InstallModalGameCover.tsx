import { Skeleton } from "@heroui/react";
import { Gamepad2 } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import { CatalogCoverImage } from "@features/steam-catalog/components/CatalogCoverImage";
import { useGameMedia } from "@hooks/useGameMedia";

export interface InstallModalGameCoverProps {
  game: ConfiguredGame;
  alt: string;
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
}

/**
 * Portada del modal de instalación: misma lógica que {@link GameCard} vía {@link useGameMedia}.
 */
export function InstallModalGameCover({ game, alt, mediaBySteamAppId }: InstallModalGameCoverProps) {
  const { coverCandidates, isEffectivelyLoading } = useGameMedia({
    game,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  if (isEffectivelyLoading) {
    return <Skeleton className="h-full w-full rounded-lg" />;
  }

  if (!coverCandidates.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-default-400" aria-hidden>
        <Gamepad2 size={32} strokeWidth={1.5} />
      </div>
    );
  }

  return <CatalogCoverImage alt={alt} candidates={coverCandidates} />;
}
