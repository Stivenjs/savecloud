import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardBody } from "@heroui/react";
import { Download, Settings2, UserPlus } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { getSteamAppdetailsMediaBatch } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { formatSize } from "@utils/format";
import { getSteamAppId } from "@utils/gameImage";
import type { FriendGameSummary } from "@hooks/useFriendsPage";
import { PublicProfileHero } from "@features/profile/PublicProfileHero";

interface FriendProfileBannerProps {
  userIdDisplay: string;
  gameCount: number;
  onAddGamesPress: () => void;
}

function FriendProfileBanner({ userIdDisplay, gameCount, onAddGamesPress }: FriendProfileBannerProps) {
  return (
    <Card className="border border-primary-200/50 bg-primary-50/30 dark:border-primary-500/20 dark:bg-primary-500/10">
      <CardBody className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            Perfil cargado
          </p>
          <p className="font-mono text-sm text-foreground">{userIdDisplay}</p>
          <p className="text-xs text-default-500">
            {gameCount} juego{gameCount !== 1 ? "s" : ""} en este perfil
          </p>
        </div>
        <Button variant="bordered" color="primary" startContent={<UserPlus size={18} />} onPress={onAddGamesPress}>
          Añadir juegos de este perfil
        </Button>
      </CardBody>
    </Card>
  );
}

export interface FriendVisualProfileProps {
  readonly profileBackground?: string;
  readonly profileAvatar?: string;
  readonly profileFrame?: string;
  readonly totalPlaytimeSeconds: number;
}

interface FriendGamesSectionProps {
  userIdDisplay: string;
  /** Cuando el miembro comparte perfil con anfitriones y el viewer es el host, muestra hero rico. */
  friendVisualProfile?: FriendVisualProfileProps | null;
  summaries: FriendGameSummary[];
  copyingGameId: string | null;
  onAddGamesPress: () => void;
  onCopySaves: (gameId: string) => void;
  onUseAsTemplate: (game: ConfiguredGame) => void;
}

export function FriendGamesSection({
  userIdDisplay,
  friendVisualProfile,
  summaries,
  copyingGameId,
  onAddGamesPress,
  onCopySaves,
  onUseAsTemplate,
}: FriendGamesSectionProps) {
  const steamAppIdsForBatch = useMemo(() => {
    const ids = summaries.map((s) => getSteamAppId(s.game, s.game.steamAppId)).filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [summaries]);

  const { data: mediaBySteamAppId } = useQuery({
    queryKey: ["steam-appdetails-media-batch", [...steamAppIdsForBatch].sort().join(",")],
    queryFn: () => getSteamAppdetailsMediaBatch(steamAppIdsForBatch),
    enabled: steamAppIdsForBatch.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const [openActionsGameId, setOpenActionsGameId] = useState<string | null>(null);
  const handleActionsMenuOpenChange = useCallback((open: boolean, gameId: string) => {
    setOpenActionsGameId(open ? gameId : null);
  }, []);

  const profileHeader =
    friendVisualProfile != null ? (
      <div className="space-y-3">
        <PublicProfileHero
          displayName={userIdDisplay}
          profileBackground={friendVisualProfile.profileBackground}
          profileAvatar={friendVisualProfile.profileAvatar}
          profileFrame={friendVisualProfile.profileFrame}
          totalPlaytimeSeconds={friendVisualProfile.totalPlaytimeSeconds}
          gamesCount={summaries.length}
        />
        <div className="flex justify-end">
          <Button variant="bordered" color="primary" startContent={<UserPlus size={18} />} onPress={onAddGamesPress}>
            Añadir juegos de este perfil
          </Button>
        </div>
      </div>
    ) : (
      <FriendProfileBanner
        userIdDisplay={userIdDisplay}
        gameCount={summaries.length}
        onAddGamesPress={onAddGamesPress}
      />
    );

  if (summaries.length === 0) {
    return (
      <div className="space-y-4">
        {profileHeader}
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-default-500">Este amigo no tiene juegos configurados en su config.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {profileHeader}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {summaries.map(({ game, fileCount, totalSize }) => {
          const hasSaves = fileCount > 0;
          const isCopying = copyingGameId === game.id;
          return (
            <div key={game.id} className="space-y-1">
              <GameCard
                game={game}
                resolvedSteamAppId={game.steamAppId}
                isLoading={false}
                mediaBySteamAppId={mediaBySteamAppId ?? null}
                mediaFromBatch
                actionsMenuOpen={openActionsGameId === game.id}
                onActionsMenuOpenChange={handleActionsMenuOpenChange}
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-default-500">
                    En la nube (amigo):{" "}
                    {hasSaves
                      ? `${fileCount} archivo${fileCount !== 1 ? "s" : ""} · ${formatSize(totalSize)}`
                      : "sin guardados"}
                  </p>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    startContent={<Download size={14} />}
                    isDisabled={!hasSaves || !!copyingGameId}
                    isLoading={isCopying}
                    onPress={() => onCopySaves(game.id)}>
                    Copiar saves
                  </Button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Settings2 size={14} />}
                    onPress={() => onUseAsTemplate(game)}>
                    Usar config como plantilla
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
