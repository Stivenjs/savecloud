import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Divider, Input, Skeleton, Tab, Tabs } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Check, Cloud, Copy, LogOut, Mail, Plus, RefreshCcw, Trash2, UserRound, Eye, X } from "lucide-react";
import type { CloudInvite, CloudMembership } from "@services/tauri/invites.service";
import { listCloudPresence } from "@services/tauri/invites.service";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { getFriendsConfigs } from "@services/tauri";
import { ProfileAvatar } from "@features/profile";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import {
  CloudMembershipActionConfirmModal,
  type CloudMembershipActionType,
} from "@features/friends/CloudMembershipActionConfirmModal";

function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-default-100 bg-default-50/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-default-100">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-default-100 text-default-600">
            {icon}
          </span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

function EmptyState({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
      <div className="h-10 w-10 rounded-full bg-default-100 flex items-center justify-center">
        {icon ?? <Mail className="h-5 w-5 text-default-400" />}
      </div>
      <p className="text-sm text-default-500">{message}</p>
    </div>
  );
}

interface FriendsInvitesTabProps {
  inviteeUserIdInput: string;
  setInviteeUserIdInput: (value: string) => void;
  inviteTokenInput: string;
  setInviteTokenInput: (value: string) => void;
  inviteBusy: boolean;
  pendingInvites: CloudInvite[];
  hostMemberships: CloudMembership[];
  memberMemberships: CloudMembership[];
  refreshInvitesState: () => void | Promise<void>;
  handleCreateInvite: () => void | Promise<void>;
  handleAcceptInviteByToken: () => void | Promise<void>;
  handleRespondInvite: (inviteId: string, action: "accept" | "reject") => void | Promise<void>;
  handleLeaveMembership: (hostUserId: string) => void | Promise<void>;
  handleRemoveMember: (memberUserId: string) => void | Promise<void>;
  handleUseHostCloud: (hostUserId: string | null) => void | Promise<void>;
  activeCloudHostUserId: string | null;
  lastCreatedInviteToken: string | null;
  handleCopyLastToken: () => void | Promise<void>;
  invitesStatsLoading: boolean;
  /** Carga el perfil (miembro o anfitrión) en la pestaña Buscar por usuario. */
  onViewCloudPeerProfile: (userId: string) => void;
  /** Opcional: Configuración local para comparar URLs de WebSocket descifradas. */
  ourConfig?: any;
}

export function FriendsInvitesTab({
  inviteeUserIdInput,
  setInviteeUserIdInput,
  inviteTokenInput,
  setInviteTokenInput,
  inviteBusy,
  pendingInvites,
  hostMemberships,
  memberMemberships,
  refreshInvitesState,
  handleCreateInvite,
  handleAcceptInviteByToken,
  handleRespondInvite,
  handleLeaveMembership,
  handleRemoveMember,
  handleUseHostCloud,
  activeCloudHostUserId,
  lastCreatedInviteToken,
  handleCopyLastToken,
  invitesStatsLoading,
  onViewCloudPeerProfile,
  ourConfig,
}: FriendsInvitesTabProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<"requests" | "cloud">("requests");
  const [pendingCloudAction, setPendingCloudAction] = useState<{
    type: CloudMembershipActionType;
    userId: string;
  } | null>(null);
  useCloudPresenceRealtimeInvalidation();

  const { data: cloudPresence = [], isLoading: cloudPresenceLoading } = useQuery({
    queryKey: ["cloud-presence"],
    queryFn: listCloudPresence,
    refetchInterval: 30_000,
  });

  const presenceByUser = useMemo(() => new Map(cloudPresence.map((item) => [item.userId, item])), [cloudPresence]);

  const getPresence = (userId: string) => presenceByUser.get(userId);

  const localUserId = (ourConfig?.userId || "").trim();

  const ownMemberMemberships = useMemo(() => {
    return memberMemberships.filter((m) => m.memberUserId === localUserId);
  }, [memberMemberships, localUserId]);

  const peerUserIds = useMemo(() => {
    const uniqueIds = new Set<string>();

    for (const m of memberMemberships) {
      if (m.active) {
        uniqueIds.add(m.hostUserId);
        uniqueIds.add(m.memberUserId);
      }
    }
    for (const m of hostMemberships) {
      if (m.active) {
        uniqueIds.add(m.memberUserId);
      }
    }
    for (const invite of pendingInvites) {
      uniqueIds.add(invite.hostUserId);
    }

    if (localUserId) {
      uniqueIds.delete(localUserId);
    }

    return Array.from(uniqueIds).sort();
  }, [hostMemberships, memberMemberships, pendingInvites, localUserId]);

  const { data: memberAvatarByUser = new Map<string, string | null>() } = useQuery({
    queryKey: ["cloud-members-avatars", peerUserIds],
    enabled: peerUserIds.length > 0,
    queryFn: async () => {
      try {
        const configsMap = await getFriendsConfigs(peerUserIds);
        const avatars = peerUserIds.map((userId) => {
          const friendConfig = configsMap[userId];
          const avatar =
            friendConfig && friendConfig.shareVisualProfileWithHosts
              ? (friendConfig.profileAvatar?.trim() ?? null)
              : null;
          return [userId, avatar] as const;
        });

        return new Map<string, string | null>(avatars);
      } catch {
        return new Map<string, string | null>(peerUserIds.map((userId) => [userId, null]));
      }
    },
  });

  const handleConfirmCloudAction = async () => {
    if (!pendingCloudAction) return;

    if (pendingCloudAction.type === "remove-member") {
      await handleRemoveMember(pendingCloudAction.userId);
    } else {
      await handleLeaveMembership(pendingCloudAction.userId);
    }

    setPendingCloudAction(null);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-default-500">{t("friends.invitesTab.subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {invitesStatsLoading ? (
          <>
            <Skeleton className="h-7 w-38 rounded-full" />
            <Skeleton className="h-7 w-44 rounded-full" />
            <Skeleton className="h-7 w-46 rounded-full" />
          </>
        ) : (
          <>
            <Chip size="sm" variant="flat" color="primary">
              {t("friends.invitesTab.statsPending", { count: pendingInvites.length })}
            </Chip>
            <Chip size="sm" variant="flat" color="secondary">
              {t("friends.invitesTab.statsShared", { count: ownMemberMemberships.length })}
            </Chip>
            <Chip size="sm" variant="flat" color="warning">
              {t("friends.invitesTab.statsMembers", { count: hostMemberships.length })}
            </Chip>
          </>
        )}
      </div>

      <Tabs
        selectedKey={view}
        onSelectionChange={(key) => setView((String(key) as "requests" | "cloud") || "requests")}
        variant="underlined"
        classNames={{ panel: "pt-4" }}>
        <Tab
          key="requests"
          title={
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span>{t("friends.invitesTab.requestsTab")}</span>
            </div>
          }>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title={t("friends.invitesTab.sendInviteTitle")} icon={<Plus className="h-4 w-4" />}>
                <div className="space-y-3 md:max-w-md">
                  <Input
                    label={t("friends.invitesTab.inviteeInputLabel")}
                    labelPlacement="outside"
                    placeholder={t("friends.profileCard.placeholder")}
                    value={inviteeUserIdInput}
                    onValueChange={setInviteeUserIdInput}
                    variant="bordered"
                    size="sm"
                    startContent={<UserRound className="h-3.5 w-3.5 text-default-400 shrink-0" />}
                  />
                  <p className="text-xs text-default-500">{t("friends.invitesTab.inviteeInputHelp")}</p>
                  <Button
                    color="primary"
                    variant="solid"
                    isLoading={inviteBusy}
                    onPress={handleCreateInvite}
                    className="w-full"
                    size="sm">
                    {t("friends.invitesTab.createInviteButton")}
                  </Button>

                  {lastCreatedInviteToken && (
                    <>
                      <Divider />
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-default-500 uppercase tracking-wide">
                          {t("friends.invitesTab.inviteTokenLabel")}
                        </p>
                        <div className="rounded-xl bg-default-100 border border-default-200 p-3">
                          <p className="font-mono text-xs break-all text-foreground leading-relaxed">
                            {lastCreatedInviteToken}
                          </p>
                        </div>
                        <p className="text-xs text-default-500">{t("friends.invitesTab.inviteTokenHelp")}</p>
                        <Button
                          size="sm"
                          variant="flat"
                          color="default"
                          className="w-full"
                          startContent={<Copy className="h-3.5 w-3.5" />}
                          onPress={() => void handleCopyLastToken()}>
                          {t("friends.invitesTab.copyLinkButton")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </SectionCard>

              <SectionCard title={t("friends.invitesTab.acceptInviteTitle")} icon={<Check className="h-4 w-4" />}>
                <div className="space-y-3 md:max-w-md">
                  <Input
                    label={t("friends.invitesTab.tokenInputLabel")}
                    labelPlacement="outside"
                    placeholder={t("friends.invitesTab.tokenInputPlaceholder")}
                    value={inviteTokenInput}
                    onValueChange={setInviteTokenInput}
                    variant="bordered"
                    size="sm"
                    startContent={<Mail className="h-3.5 w-3.5 text-default-400 shrink-0" />}
                  />
                  <p className="text-xs text-default-500">{t("friends.invitesTab.tokenInputHelp")}</p>
                  <Button
                    color="primary"
                    variant="solid"
                    isLoading={inviteBusy}
                    isDisabled={!inviteTokenInput.trim() || inviteBusy}
                    onPress={handleAcceptInviteByToken}
                    className="w-full"
                    size="sm"
                    startContent={!inviteBusy && <Check className="h-3.5 w-3.5" />}>
                    {t("friends.invitesTab.acceptButton")}
                  </Button>
                </div>
              </SectionCard>
            </div>

            <SectionCard
              title={t("friends.invitesTab.pendingInvitesTitle")}
              icon={<Mail className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<RefreshCcw className="h-3.5 w-3.5" />}
                    onPress={() => void refreshInvitesState()}>
                    {t("friends.invitesTab.refreshButton")}
                  </Button>
                </div>
              }>
              <p className="mb-3 text-xs text-default-500">{t("friends.invitesTab.refreshHelp")}</p>
              {pendingInvites.length === 0 ? (
                <EmptyState
                  message={t("friends.invitesTab.noPendingInvites")}
                  icon={<Mail className="h-5 w-5 text-default-400" />}
                />
              ) : (
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-default-200 bg-default-50 p-3">
                      <div className="flex items-center gap-3">
                        <ProfileAvatar
                          rawAvatar={memberAvatarByUser.get(invite.hostUserId)}
                          userId={invite.hostUserId}
                          size="sm"
                        />
                        <div>
                          <p className="text-sm font-medium">{invite.hostUserId}</p>
                          <p className="text-xs text-default-400">
                            {t("friends.invitesTab.expiresAt", { date: new Date(invite.expiresAt).toLocaleString() })}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<Check className="h-3.5 w-3.5" />}
                          onPress={() => void handleRespondInvite(invite.id, "accept")}>
                          {t("friends.invitesTab.acceptBtn")}
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant="light"
                          startContent={<X className="h-3.5 w-3.5" />}
                          onPress={() => void handleRespondInvite(invite.id, "reject")}>
                          {t("friends.invitesTab.rejectBtn")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </Tab>

        <Tab
          key="cloud"
          title={
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              <span>{t("friends.invitesTab.sharedCloudTab")}</span>
            </div>
          }>
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title={t("friends.invitesTab.activeCloudTitle")} icon={<Cloud className="h-4 w-4" />}>
              <div className="space-y-3">
                <p className="text-xs text-default-500">{t("friends.invitesTab.activeCloudHelp")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={activeCloudHostUserId ? "flat" : "solid"}
                    color={activeCloudHostUserId ? "default" : "primary"}
                    startContent={<Cloud className="h-3.5 w-3.5" />}
                    onPress={() => void handleUseHostCloud(null)}>
                    {t("friends.invitesTab.myCloud")}
                  </Button>
                  {ownMemberMemberships.map((m) => (
                    <Button
                      key={`active-${m.hostUserId}`}
                      size="sm"
                      variant={activeCloudHostUserId === m.hostUserId ? "solid" : "flat"}
                      color={activeCloudHostUserId === m.hostUserId ? "primary" : "default"}
                      onPress={() => void handleUseHostCloud(m.hostUserId)}>
                      {m.hostUserId}
                    </Button>
                  ))}
                </div>

                <Divider />

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-default-500">
                    {t("friends.invitesTab.cloudsAsMember")}
                  </p>
                  {ownMemberMemberships.length === 0 ? (
                    <EmptyState
                      message={t("friends.invitesTab.noSharedClouds")}
                      icon={<Cloud className="h-5 w-5 text-default-400" />}
                    />
                  ) : (
                    <div className="space-y-2">
                      {ownMemberMemberships.map((m) => (
                        <div
                          key={`${m.hostUserId}-${m.memberUserId}`}
                          className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-2">
                            <ProfileAvatar
                              rawAvatar={memberAvatarByUser.get(m.hostUserId)}
                              userId={m.hostUserId}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">{m.hostUserId}</p>
                              <p className="text-[10px] text-default-400">
                                {t("friends.invitesTab.host")}
                                {getPresence(m.hostUserId)?.status === "playing" && getPresence(m.hostUserId)?.gameName
                                  ? ` · ${getPresence(m.hostUserId)?.gameName}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <PresenceStatusChip
                              loading={cloudPresenceLoading}
                              status={getPresence(m.hostUserId)?.status}
                            />
                            {m.wsUrl && ourConfig?.cloudHostWsBaseUrls?.[m.hostUserId] !== m.wsUrl ? (
                              <Button
                                size="sm"
                                variant="flat"
                                color="warning"
                                startContent={<RefreshCcw className="h-3.5 w-3.5" />}
                                onPress={() => void handleUseHostCloud(m.hostUserId)}>
                                {t("friends.invitesTab.syncConnection")}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              startContent={<Eye className="h-3.5 w-3.5" />}
                              onPress={() => onViewCloudPeerProfile(m.hostUserId)}>
                              {t("friends.invitesTab.viewProfile")}
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              color="warning"
                              startContent={<LogOut className="h-3.5 w-3.5" />}
                              onPress={() => setPendingCloudAction({ type: "leave-membership", userId: m.hostUserId })}>
                              {t("friends.invitesTab.leave")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t("friends.invitesTab.membersInCloudTitle")} icon={<UserRound className="h-4 w-4" />}>
              <div className="space-y-3">
                <p className="text-xs text-default-500">{t("friends.invitesTab.membersInCloudHelp")}</p>
                {hostMemberships.length === 0 ? (
                  <EmptyState
                    message={t("friends.invitesTab.noMembersActive")}
                    icon={<UserRound className="h-5 w-5 text-default-400" />}
                  />
                ) : (
                  <div className="space-y-2">
                    {hostMemberships.map((m) => (
                      <div
                        key={`${m.hostUserId}-${m.memberUserId}`}
                        className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProfileAvatar
                            rawAvatar={memberAvatarByUser.get(m.memberUserId)}
                            userId={m.memberUserId}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{m.memberUserId}</p>
                            <p className="text-[10px] text-default-400">
                              {t("friends.invitesTab.member")}
                              {getPresence(m.memberUserId)?.status === "playing" &&
                              getPresence(m.memberUserId)?.gameName
                                ? ` · ${getPresence(m.memberUserId)?.gameName}`
                                : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          <PresenceStatusChip
                            loading={cloudPresenceLoading}
                            status={getPresence(m.memberUserId)?.status}
                          />
                          <Button
                            size="sm"
                            variant="flat"
                            color="primary"
                            startContent={<Eye className="h-3.5 w-3.5" />}
                            onPress={() => onViewCloudPeerProfile(m.memberUserId)}>
                            {t("friends.invitesTab.viewProfile")}
                          </Button>
                          <Button
                            size="sm"
                            variant="light"
                            color="danger"
                            startContent={<Trash2 className="h-3.5 w-3.5" />}
                            onPress={() => setPendingCloudAction({ type: "remove-member", userId: m.memberUserId })}>
                            {t("friends.invitesTab.delete")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </Tab>
      </Tabs>

      <CloudMembershipActionConfirmModal
        isOpen={pendingCloudAction !== null}
        actionType={pendingCloudAction?.type ?? "remove-member"}
        userId={pendingCloudAction?.userId ?? ""}
        onClose={() => setPendingCloudAction(null)}
        onConfirm={handleConfirmCloudAction}
        isLoading={inviteBusy}
      />
    </div>
  );
}

export function InvitesTabTitle({ pendingCount, statsLoading }: { pendingCount: number; statsLoading?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Mail className="h-4 w-4" />
      <span>{t("friends.invitesTab.requestsTab")}</span>
      {statsLoading ? (
        <Skeleton className="h-5 w-6 rounded-md" />
      ) : pendingCount > 0 ? (
        <Chip size="sm" color="primary" variant="solid" className="h-4 min-w-4 px-1 text-[10px]">
          {pendingCount}
        </Chip>
      ) : null}
    </div>
  );
}
