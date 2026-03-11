import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardBody } from "@heroui/react";
import { Download, Settings2, UserPlus } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { getSteamAppdetailsMediaBatch } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { formatSize } from "@utils/format";
import { getSteamAppId } from "@utils/gameImage";
import type { FriendGameSummary } from "./useFriendsPage";

interface FriendGamesSectionProps {
  userIdDisplay: string;
  summaries: FriendGameSummary[];
  copyingGameId: string | null;
  onAddGamesPress: () => void;
  onCopySaves: (gameId: string) => void;
  onUseAsTemplate: (game: ConfiguredGame) => void;
}

export function FriendGamesSection({
  userIdDisplay,
  summaries,
  copyingGameId,
  onAddGamesPress,
  onCopySaves,
  onUseAsTemplate,
}: FriendGamesSectionProps) {
  const steamAppIdsForBatch = useMemo(() => {
    const ids = summaries
      .map((s) => getSteamAppId(s.game, s.game.steamAppId))
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [summaries]);

  const { data: mediaBySteamAppId } = useQuery({
    queryKey: [
      "steam-appdetails-media-batch",
      [...steamAppIdsForBatch].sort().join(","),
    ],
    queryFn: () => getSteamAppdetailsMediaBatch(steamAppIdsForBatch),
    enabled: steamAppIdsForBatch.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (summaries.length === 0) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-default-500">
            Este amigo no tiene juegos configurados en su config.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-default-500">
          Perfil de:{" "}
          <span className="font-mono text-default-700">{userIdDisplay}</span>
        </p>
        <Button
          variant="bordered"
          color="primary"
          startContent={<UserPlus size={18} />}
          onPress={onAddGamesPress}
        >
          Añadir juegos de este perfil
        </Button>
      </div>
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
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-default-500">
                    En la nube (amigo):{" "}
                    {hasSaves
                      ? `${fileCount} archivo${
                          fileCount !== 1 ? "s" : ""
                        } · ${formatSize(totalSize)}`
                      : "sin guardados"}
                  </p>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    startContent={<Download size={14} />}
                    isDisabled={!hasSaves || !!copyingGameId}
                    isLoading={isCopying}
                    onPress={() => onCopySaves(game.id)}
                  >
                    Copiar saves
                  </Button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Settings2 size={14} />}
                    onPress={() => onUseAsTemplate(game)}
                  >
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
