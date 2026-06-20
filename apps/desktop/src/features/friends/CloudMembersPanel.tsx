import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Spinner, useDraggable } from "@heroui/react";
import { motion } from "framer-motion";
import { UserRound } from "lucide-react";
import { getFriendConfig } from "@services/tauri";
import { listCloudMemberships, listCloudPresence } from "@services/tauri/invites.service";
import { CloudMembersHeader } from "@features/friends/CloudMembersHeader";
import {
  CloudMembershipActionConfirmModal,
  type CloudMembershipActionType,
} from "@features/friends/CloudMembershipActionConfirmModal";
import { CloudMembersSection } from "@features/friends/CloudMembersSection";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useProfileSession } from "@hooks/useProfileSession";
import { useConfig } from "@hooks/useConfig";
import { resolveProfileAsset } from "@utils/profileMedia";

interface CloudMembersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
  containerRef?: React.RefObject<HTMLElement>;
  draggable?: boolean;
  onDetachToWindow?: () => void;
  showCloseButton?: boolean;
}

export function CloudMembersPanel({
  isOpen,
  onClose,
  onViewProfile,
  onRemoveMember,
  onLeaveMembership,
  containerRef,
  draggable = true,
  onDetachToWindow,
  showCloseButton = true,
}: CloudMembersPanelProps) {
  const { activeProfile } = useProfileSession();
  const { config } = useConfig();

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: CloudMembershipActionType; userId: string } | null>(null);

  const { moveProps } = useDraggable({
    targetRef: containerRef,
    canOverflow: false,
    isDisabled: !isOpen || !draggable,
  });

  useCloudPresenceRealtimeInvalidation(isOpen);

  useRegisterGlobalBack(() => {
    if (!isOpen) return false;
    onClose();
    return true;
  });

  const {
    data: memberships,
    isLoading: membershipsLoading,
    isError: membershipsError,
    refetch: refetchMemberships,
  } = useQuery({
    queryKey: ["cloud-memberships"],
    queryFn: listCloudMemberships,
    refetchInterval: isOpen ? 30_000 : false,
    enabled: isOpen,
  });

  const {
    data: cloudPresence = [],
    isLoading: cloudPresenceLoading,
    refetch: refetchPresence,
  } = useQuery({
    queryKey: ["cloud-presence"],
    queryFn: listCloudPresence,
    refetchInterval: isOpen ? 30_000 : false,
    enabled: isOpen,
  });

  const presenceByUser = useMemo(() => new Map(cloudPresence.map((item) => [item.userId, item])), [cloudPresence]);

  const localUserId = (activeProfile?.localUserId || config?.userId || "").trim();
  const localProfileAvatar = resolveProfileAsset(config?.profileAvatar ?? undefined);
  const localPresence = localUserId ? presenceByUser.get(localUserId) : undefined;

  const hostMemberships = useMemo(() => (memberships?.hostMemberships ?? []).filter((m) => m.active), [memberships]);
  const memberMemberships = useMemo(
    () => (memberships?.memberMemberships ?? []).filter((m) => m.active),
    [memberships]
  );
  const hasAnyMembers = hostMemberships.length > 0 || memberMemberships.length > 0;

  const cloudPeerIds = useMemo(() => {
    const uniqueIds = new Set<string>();

    for (const membership of hostMemberships) {
      uniqueIds.add(membership.memberUserId);
    }
    for (const membership of memberMemberships) {
      uniqueIds.add(membership.hostUserId);
      uniqueIds.add(membership.memberUserId);
    }

    if (localUserId) {
      uniqueIds.delete(localUserId);
    }

    return Array.from(uniqueIds).sort();
  }, [hostMemberships, memberMemberships, localUserId]);

  const { data: memberAvatarByUser = new Map<string, string | null>() } = useQuery({
    queryKey: ["cloud-members-avatars", cloudPeerIds],
    enabled: isOpen && cloudPeerIds.length > 0,
    queryFn: async () => {
      const avatars = await Promise.all(
        cloudPeerIds.map(async (userId) => {
          try {
            const friendConfig = await getFriendConfig(userId);
            const avatar = friendConfig.shareVisualProfileWithHosts
              ? (friendConfig.profileAvatar?.trim() ?? null)
              : null;
            return [userId, avatar] as const;
          } catch {
            return [userId, null] as const;
          }
        })
      );

      return new Map<string, string | null>(avatars);
    },
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchMemberships(), refetchPresence()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchMemberships, refetchPresence]);

  const handleViewProfile = useCallback(
    (userId: string) => {
      onViewProfile(userId);
      onClose();
    },
    [onViewProfile, onClose]
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!onRemoveMember) return;
      setIsActionLoading(userId);
      try {
        await onRemoveMember(userId);
      } finally {
        setIsActionLoading(null);
      }
    },
    [onRemoveMember]
  );

  const handleLeaveMembership = useCallback(
    async (hostId: string) => {
      if (!onLeaveMembership) return;
      setIsActionLoading(hostId);
      try {
        await onLeaveMembership(hostId);
      } finally {
        setIsActionLoading(null);
      }
    },
    [onLeaveMembership]
  );

  const handleConfirmPendingAction = useCallback(async () => {
    if (!pendingAction) return;

    if (pendingAction.type === "remove-member") {
      await handleRemoveMember(pendingAction.userId);
      return;
    }

    await handleLeaveMembership(pendingAction.userId);
  }, [pendingAction, handleRemoveMember, handleLeaveMembership]);

  const handleClosePendingAction = useCallback(() => setPendingAction(null), []);

  return (
    <motion.div layout className="flex h-full flex-col">
      <motion.div layout className="w-full">
        <div {...moveProps} className="w-full p-0">
          <CloudMembersHeader
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
            onClose={onClose}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            moveProps={draggable ? moveProps : undefined}
            onDetachToWindow={onDetachToWindow}
            showCloseButton={showCloseButton}
          />
        </div>
      </motion.div>

      <motion.div layout className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-2.5 py-2.5">
          {membershipsLoading ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-default-500">
              <Spinner size="md" color="primary" />
              <p className="text-sm">Cargando miembros...</p>
            </div>
          ) : null}

          {!membershipsLoading && membershipsError ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              No se pudieron cargar los miembros.
            </div>
          ) : null}

          {!membershipsLoading && !membershipsError && !hasAnyMembers ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-default-200/80 bg-background/45 px-4 py-6 text-center">
              <UserRound className="h-5 w-5 text-default-400" />
              <p className="text-sm text-default-500">No hay miembros cloud para mostrar.</p>
            </div>
          ) : null}

          {!membershipsLoading && !membershipsError && hasAnyMembers ? (
            <div className="space-y-3">
              {localUserId ? (
                <section className="rounded-lg border border-default-200/70 bg-default-50/35 px-2.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={localUserId} src={localProfileAvatar ?? undefined} size="md" className="shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{localUserId}</p>
                        <p className="truncate text-[11px] text-default-500">
                          {localPresence?.status === "playing"
                            ? `Jugando${localPresence?.gameName ? ` · ${localPresence.gameName}` : ""}`
                            : "Tu cuenta"}
                        </p>
                      </div>
                    </div>
                    <PresenceStatusChip loading={cloudPresenceLoading} status={localPresence?.status} />
                  </div>
                </section>
              ) : null}

              <CloudMembersSection
                title="En tu nube"
                memberships={hostMemberships}
                presenceMap={presenceByUser}
                avatarByUser={memberAvatarByUser}
                isHost={true}
                loadingPresence={cloudPresenceLoading}
                isActionLoading={isActionLoading}
                onViewProfile={handleViewProfile}
                onRequestRemoveMember={(userId) => setPendingAction({ type: "remove-member", userId })}
                onRemoveMember={onRemoveMember ? handleRemoveMember : undefined}
                searchQuery={debouncedSearchQuery}
                localUserId={localUserId}
              />

              <CloudMembersSection
                title="Miembro de"
                memberships={memberMemberships}
                presenceMap={presenceByUser}
                avatarByUser={memberAvatarByUser}
                isHost={false}
                loadingPresence={cloudPresenceLoading}
                isActionLoading={isActionLoading}
                onViewProfile={handleViewProfile}
                onRequestLeaveMembership={(hostId) => setPendingAction({ type: "leave-membership", userId: hostId })}
                onLeaveMembership={onLeaveMembership ? handleLeaveMembership : undefined}
                searchQuery={debouncedSearchQuery}
                localUserId={localUserId}
              />
            </div>
          ) : null}
        </div>
      </motion.div>

      <CloudMembershipActionConfirmModal
        isOpen={pendingAction !== null}
        actionType={pendingAction?.type ?? "remove-member"}
        userId={pendingAction?.userId ?? ""}
        onClose={handleClosePendingAction}
        onConfirm={handleConfirmPendingAction}
        isLoading={pendingAction ? isActionLoading === pendingAction.userId : false}
      />
    </motion.div>
  );
}
