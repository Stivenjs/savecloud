import { addTransitionType, startTransition, useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardBody } from "@heroui/react";
import { Download, Settings2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { getSteamAppdetailsMediaBatch } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { formatSize } from "@utils/format";
import { getSteamAppId, formatGameDisplayName } from "@utils/gameImage";
import type { FriendGameSummary } from "@hooks/useFriendsPage";
import { PublicProfileHero } from "@features/profile/PublicProfileHero";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { PlayingStatusBadge } from "@features/games/PlayingStatusBadge";

interface FriendProfileBannerProps {
  userIdDisplay: string;
  gameCount: number;
  onAddGamesPress: () => void;
  presenceStatus?: "offline" | "online" | "playing";
  presenceGameId?: string | null;
  presenceGameName?: string | null;
  presenceImageUrl?: string | null;
  presenceSteamAppId?: string | null;
  fallbackStartedAt?: number | null;
}

function FriendProfileBanner({
  userIdDisplay,
  gameCount,
  onAddGamesPress,
  presenceStatus,
  presenceGameId,
  presenceGameName,
  presenceImageUrl,
  presenceSteamAppId,
  fallbackStartedAt,
}: FriendProfileBannerProps) {
  const { t } = useTranslation();

  return (
    <Card className="border border-primary-200/50 bg-primary-50/30 dark:border-primary-500/20 dark:bg-primary-500/10">
      <CardBody className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            {t("friends.gamesSection.profileLoaded")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm text-foreground">{userIdDisplay}</p>
            {presenceStatus !== "playing" && <PresenceStatusChip status={presenceStatus} />}
          </div>
          <p className="text-xs text-default-500">{t("friends.gamesSection.gamesInProfile", { count: gameCount })}</p>
          {presenceStatus === "playing" && (presenceGameName || presenceGameId) ? (
            <div className="pt-1">
              <PlayingStatusBadge
                gameId={presenceGameId}
                gameName={presenceGameName}
                imageUrl={presenceImageUrl}
                steamAppId={presenceSteamAppId}
                fallbackStartedAt={fallbackStartedAt}
                userId={userIdDisplay}
                variant="inline"
                size="sm"
              />
            </div>
          ) : null}
        </div>
        <Button variant="bordered" color="primary" startContent={<UserPlus size={18} />} onPress={onAddGamesPress}>
          {t("friends.gamesSection.actions.addGames")}
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
  presenceStatus?: "offline" | "online" | "playing";
  presenceGameId?: string | null;
  presenceGameName?: string | null;
  fallbackStartedAt?: number | null;
  copyingGameId: string | null;
  onAddGamesPress: () => void;
  onCopySaves: (gameId: string) => void;
  onUseAsTemplate: (game: ConfiguredGame) => void;
}

export function FriendGamesSection({
  userIdDisplay,
  friendVisualProfile,
  summaries,
  presenceStatus,
  presenceGameId,
  presenceGameName,
  fallbackStartedAt,
  copyingGameId,
  onAddGamesPress,
  onCopySaves,
  onUseAsTemplate,
}: FriendGamesSectionProps) {
  const { t } = useTranslation();
  const isLowPerf = useLowPerformanceMode();
  const navigate = useNavigate();
  const location = useLocation();

  const activePlayingSummary = useMemo(() => {
    if (presenceStatus !== "playing") return null;
    const cleanId = presenceGameId?.trim().toLowerCase();
    const cleanName = presenceGameName?.trim().toLowerCase();
    if (!cleanId && !cleanName) return null;

    return (
      summaries.find((s) => {
        const gid = s.game.id.toLowerCase();
        const gDisplayName = formatGameDisplayName(s.game.id).toLowerCase();
        const normId = gid.replace(/[-_ ]/g, "");
        const normName = gDisplayName.replace(/[-_ ]/g, "");
        const targetId = cleanId ? cleanId.replace(/[-_ ]/g, "") : "";
        const targetName = cleanName ? cleanName.replace(/[-_ ]/g, "") : "";

        return (
          (targetId && (normId === targetId || normName === targetId)) ||
          (targetName && (normId === targetName || normName === targetName))
        );
      }) ?? null
    );
  }, [summaries, presenceStatus, presenceGameId, presenceGameName]);

  const activeGameId = presenceGameId || activePlayingSummary?.game.id || null;
  const activeGameName =
    presenceGameName || (activePlayingSummary ? formatGameDisplayName(activePlayingSummary.game.id) : null);
  const activeImageUrl = activePlayingSummary?.game.imageUrl || null;
  const activeSteamAppId = activePlayingSummary?.game.steamAppId || null;

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

  const handleCardNavigate = useCallback(
    (game: ConfiguredGame) => {
      const targetId = game.steamAppId ? `${STEAM_CATALOG_GAME_ID_PREFIX}${game.steamAppId}` : game.id;

      if (isLowPerf) {
        navigate(`/games/${targetId}`, {
          state: { resolvedSteamAppId: game.steamAppId, from: `${location.pathname}${location.search}` },
        });
        return;
      }
      startTransition(() => {
        addTransitionType("game-detail");
        navigate(`/games/${targetId}`, {
          state: { resolvedSteamAppId: game.steamAppId, from: `${location.pathname}${location.search}` },
        });
      });
    },
    [navigate, location, isLowPerf]
  );

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
          statusContent={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {presenceStatus !== "playing" && <PresenceStatusChip status={presenceStatus} />}
              {presenceStatus === "playing" && (activeGameName || activeGameId) ? (
                <PlayingStatusBadge
                  gameId={activeGameId}
                  gameName={activeGameName}
                  imageUrl={activeImageUrl}
                  steamAppId={activeSteamAppId}
                  fallbackStartedAt={fallbackStartedAt}
                  userId={userIdDisplay}
                  variant="inline"
                  size="sm"
                />
              ) : null}
            </div>
          }
        />
        <div className="flex justify-end">
          <Button variant="bordered" color="primary" startContent={<UserPlus size={18} />} onPress={onAddGamesPress}>
            {t("friends.gamesSection.actions.addGames")}
          </Button>
        </div>
      </div>
    ) : (
      <FriendProfileBanner
        userIdDisplay={userIdDisplay}
        gameCount={summaries.length}
        presenceStatus={presenceStatus}
        presenceGameId={activeGameId}
        presenceGameName={activeGameName}
        presenceImageUrl={activeImageUrl}
        presenceSteamAppId={activeSteamAppId}
        fallbackStartedAt={fallbackStartedAt}
        onAddGamesPress={onAddGamesPress}
      />
    );

  if (summaries.length === 0) {
    return (
      <div className="space-y-4">
        {profileHeader}
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-default-500">{t("friends.gamesSection.noGames")}</p>
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
                onCardNavigate={handleCardNavigate}
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-default-500">
                    {t("friends.gamesSection.inCloudFriend")}{" "}
                    {hasSaves
                      ? t("friends.gamesSection.filesStats", { count: fileCount, size: formatSize(totalSize) })
                      : t("friends.gamesSection.noSaves")}
                  </p>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    startContent={<Download size={14} />}
                    isDisabled={!hasSaves || !!copyingGameId}
                    isLoading={isCopying}
                    onPress={() => onCopySaves(game.id)}>
                    {t("friends.gamesSection.actions.copySaves")}
                  </Button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Settings2 size={14} />}
                    onPress={() => onUseAsTemplate(game)}>
                    {t("friends.gamesSection.actions.useTemplate")}
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
