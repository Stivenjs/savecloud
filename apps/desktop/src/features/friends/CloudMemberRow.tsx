import { Avatar } from "@heroui/react";
import type { CloudMembership } from "@services/tauri/invites.service";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { CloudMemberActions } from "@features/friends/CloudMemberActions";
import { resolveProfileAsset } from "@utils/profileMedia";

interface CloudMemberRowProps {
  membership: CloudMembership;
  isHost: boolean;
  userId: string;
  status?: "offline" | "online" | "playing";
  gameName?: string | null;
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
  gameName,
  loadingPresence,
  isActionLoading = false,
  onViewProfile,
  userAvatar,
  onRequestRemoveMember,
  onRequestLeaveMembership,
  onRemoveMember,
  onLeaveMembership,
}: CloudMemberRowProps) {
  const avatarSrc = resolveProfileAsset(userAvatar ?? undefined);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-default-200/60 bg-default-50/30 px-2.5 py-2 backdrop-blur-sm hover:border-default-300/80 hover:bg-default-50/50 transition-colors">
      <div className="flex min-w-0 items-center gap-2 flex-1">
        <Avatar name={userId} src={avatarSrc ?? undefined} size="md" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{userId}</p>
          <div className="flex items-center gap-1">
            <p className="truncate text-[10px] text-default-500">
              {isHost ? "Miembro" : userId === membership.hostUserId ? "Anfitrión" : "Miembro"}
            </p>
            {gameName && status === "playing" && <p className="truncate text-[10px] text-default-400">· {gameName}</p>}
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
