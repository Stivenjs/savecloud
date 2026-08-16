import type { CloudMembership } from "@services/tauri/invites.service";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { CloudMemberActions } from "@features/friends/CloudMemberActions";
import { ProfileAvatar } from "@features/profile";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";
import { useGameSessionDuration } from "@store/GameSessionStore";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";

interface CloudMemberRowProps {
  membership: CloudMembership;
  isHost: boolean;
  userId: string;
  status?: "offline" | "online" | "playing";
  gameId?: string | null;
  gameName?: string | null;
  lastSeenAt?: number | null;
  loadingPresence: boolean;
  isActionLoading?: boolean;
  onViewProfile: (userId: string) => void;
  userAvatar?: string | null;
  onRequestRemoveMember?: (userId: string) => void;
  onRequestLeaveMembership?: (hostId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
}

export function CloudMemberRow({
  membership,
  isHost,
  userId,
  status,
  gameId,
  gameName,
  lastSeenAt,
  loadingPresence,
  isActionLoading = false,
  onViewProfile,
  userAvatar,
  onRequestRemoveMember,
  onRequestLeaveMembership,
  onRemoveMember,
  onLeaveMembership,
}: CloudMemberRowProps) {
  const { t } = useTranslation();

  const isPlaying = status === "playing" && Boolean(gameName || gameId);
  const { formattedDuration, sessionSeconds } = useGameSessionDuration({
    gameId,
    userId,
    fallbackStartedAt: lastSeenAt,
    isRunning: isPlaying,
  });

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-default-200/60 bg-default-50/30 px-2.5 py-2 backdrop-blur-sm hover:border-default-300/80 hover:bg-default-50/50 transition-colors">
      <div className="flex min-w-0 items-center gap-2 flex-1">
        <ProfileAvatar rawAvatar={userAvatar} userId={userId} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{userId}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <p className="truncate text-[10px] text-default-500">
              {isHost
                ? t("friends.cloudMembers.member")
                : userId === membership.hostUserId
                  ? t("friends.cloudMembers.host")
                  : t("friends.cloudMembers.member")}
            </p>
            {isPlaying && (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] text-default-400">·</span>
                <PlayingGameThumbnail gameId={gameId} gameName={gameName} size="xs" />
                <span className="truncate text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                  {gameName || gameId}
                </span>
                {sessionSeconds > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9.5px] text-default-400">
                    <Clock size={9} className="text-emerald-400" />
                    <span>{formattedDuration}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <PresenceStatusChip loading={loadingPresence} status={status} />
        <CloudMemberActions
          userId={userId}
          membership={membership}
          isHost={isHost}
          isLoading={isActionLoading || loadingPresence}
          onViewProfile={onViewProfile}
          onRequestRemoveMember={onRequestRemoveMember}
          onRequestLeaveMembership={onRequestLeaveMembership}
          onRemoveMember={onRemoveMember}
          onLeaveMembership={onLeaveMembership}
        />
      </div>
    </div>
  );
}
