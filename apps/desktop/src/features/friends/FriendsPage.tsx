import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBigPictureConsole } from "@hooks/useBigPictureConsole";
import { BigPictureFriendsPage } from "@features/friends/big-picture/BigPictureFriendsPage";
import { useQuery } from "@tanstack/react-query";
import { Chip, Spinner, Tab, Tabs } from "@heroui/react";
import { Link2, UserRound } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { useFriendsPage } from "@/hooks/useFriendsPage";
import { AddFriendGamesModal } from "@features/friends/AddFriendGamesModal";
import { FriendGameTemplateModal } from "@features/friends/FriendGameTemplateModal";
import { FriendGamesSection } from "@features/friends/FriendGamesSection";
import { FriendProfileCard } from "@features/friends/FriendProfileCard";
import { ShareLinkCard } from "@features/friends/ShareLinkCard";
import { ShareLinkImportConfirmModal } from "@features/friends/ShareLinkImportConfirmModal";
import { CopyFriendSavesConfirmModal } from "@features/friends/CopyFriendSavesConfirmModal";
import { FriendsInvitesTab, InvitesTabTitle } from "@features/friends/FriendsInvitesTab";
import {
  consumePendingFriendProfileUserId,
  onRequestOpenFriendProfile,
} from "@features/friends/friendProfileNavigation";
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import { listCloudPresence } from "@services/tauri/invites.service";
import { visibilityManager } from "@hooks/useAppVisibility";

type FriendsTabKey = "link" | "user" | "invites";

export function FriendsPage() {
  const { t } = useTranslation();
  const bigPictureConsole = useBigPictureConsole();

  if (bigPictureConsole) return <BigPictureFriendsPage />;

  const [friendsTab, setFriendsTab] = useState<FriendsTabKey>(() => {
    try {
      return (sessionStorage.getItem("friendsPageTab") as FriendsTabKey) || "link";
    } catch {
      return "link";
    }
  });

  const popLayer = useNavigationStore((s) => s.popLayer);
  const {
    friendIdInput,
    setFriendIdInput,
    loading,
    error,
    friendConfig,
    summaries,
    copyingGameId,
    ourGameIds,
    templateGame,
    setTemplateGame,
    templateOpen,
    setTemplateOpen,
    addFriendGamesOpen,
    setAddFriendGamesOpen,
    shareLinkInput,
    setShareLinkInput,
    shareLinkLoading,
    shareLinkPreview,
    setShareLinkPreview,
    shareLinkConfirmLoading,
    copyConfirmPreview,
    setCopyConfirmPreview,
    handleConfirmCopySaves,
    ourConfig,
    handleLoadFriend,
    handleImportFromShareLink,
    handleConfirmShareLinkImport,
    handleCopySaves,
    invalidateConfig,
    inviteeUserIdInput,
    setInviteeUserIdInput,
    inviteTokenInput,
    setInviteTokenInput,
    inviteBusy,
    pendingInvites,
    invitesStatsLoading,
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
    loadFriendProfileById,
  } = useFriendsPage();

  const handleAddGamesPress = useCallback(() => setAddFriendGamesOpen(true), [setAddFriendGamesOpen]);
  const handleUseAsTemplate = useCallback((game: ConfiguredGame) => setTemplateGame(game), [setTemplateGame]);
  useCloudPresenceRealtimeInvalidation();

  const { data: cloudPresence = [] } = useQuery({
    queryKey: ["cloud-presence"],
    queryFn: listCloudPresence,
    refetchInterval: 30_000,
  });

  const searchedFriendPresence = friendConfig?.userId
    ? cloudPresence.find((item) => item.userId === friendConfig.userId)
    : undefined;

  useEffect(() => {
    const openProfileById = (userId: string) => {
      const normalized = userId.trim();
      if (!normalized) return;
      setFriendsTab("user");
      try {
        sessionStorage.setItem("friendsPageTab", "user");
      } catch {}
      void loadFriendProfileById(normalized);
    };

    const pendingUserId = consumePendingFriendProfileUserId();
    if (pendingUserId) {
      openProfileById(pendingUserId);
    }

    return onRequestOpenFriendProfile(openProfileById);
  }, [loadFriendProfileById]);

  useEffect(() => {
    if (friendsTab !== "invites") return;

    void refreshInvitesState();
    const id = window.setInterval(() => {
      // Evitar polling de invitaciones cuando la app está en background.
      if (!visibilityManager.isVisible) return;
      void refreshInvitesState();
    }, 30000);

    return () => window.clearInterval(id);
  }, [friendsTab, refreshInvitesState]);

  useRegisterGlobalBack(() => {
    switch (true) {
      case !!copyConfirmPreview:
        setCopyConfirmPreview(null);
        return true;
      case !!shareLinkPreview:
        setShareLinkPreview(null);
        return true;
      case templateOpen:
        setTemplateOpen(false);
        setTemplateGame(null);
        return true;
      case addFriendGamesOpen:
        setAddFriendGamesOpen(false);
        return true;
      default:
        popLayer();
        return true;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{t("friends.title")}</h1>
          <Chip size="sm" variant="flat" color="default" className="text-xs">
            {t("friends.subtitle")}
          </Chip>
        </div>
        <p className="max-w-3xl text-sm text-default-500">{t("friends.descPlain")}</p>
      </div>

      <Tabs
        selectedKey={friendsTab}
        onSelectionChange={(k) => {
          const nextTab = (String(k) as FriendsTabKey) || "link";
          setFriendsTab(nextTab);
          try {
            sessionStorage.setItem("friendsPageTab", nextTab);
          } catch {}
          if (nextTab === "invites") {
            void refreshInvitesState();
          }
        }}
        variant="underlined"
        classNames={{ panel: "pt-4" }}>
        <Tab
          key="link"
          title={
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              <span>{t("friends.tabs.importLink")}</span>
            </div>
          }>
          <ShareLinkCard
            shareLinkInput={shareLinkInput}
            onShareLinkChange={setShareLinkInput}
            onImportPress={handleImportFromShareLink}
            loading={shareLinkLoading}
            disabled={!ourConfig?.apiBaseUrl?.trim()}
          />
        </Tab>

        <Tab
          key="user"
          title={
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              <span>{t("friends.tabs.searchUser")}</span>
            </div>
          }>
          <div className="space-y-6">
            <FriendProfileCard
              friendIdInput={friendIdInput}
              onFriendIdChange={setFriendIdInput}
              onLoadPress={handleLoadFriend}
              loading={loading}
              error={error}
            />
            {loading ? (
              <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
                <Spinner size="lg" color="primary" />
                <p className="text-default-500">{t("friends.loadingProfile")}</p>
              </div>
            ) : null}
            {friendConfig && !loading ? (
              <FriendGamesSection
                userIdDisplay={friendConfig.userId ?? t("friends.noUserConfig")}
                friendVisualProfile={
                  friendConfig.shareVisualProfileWithHosts
                    ? {
                        profileBackground: friendConfig.profileBackground,
                        profileAvatar: friendConfig.profileAvatar,
                        profileFrame: friendConfig.profileFrame,
                        totalPlaytimeSeconds: friendConfig.totalPlaytime ?? 0,
                      }
                    : null
                }
                summaries={summaries}
                presenceStatus={searchedFriendPresence?.status}
                presenceGameId={searchedFriendPresence?.gameId ?? null}
                presenceGameName={searchedFriendPresence?.gameName ?? null}
                fallbackStartedAt={searchedFriendPresence?.lastSeenAt ?? null}
                copyingGameId={copyingGameId}
                onAddGamesPress={handleAddGamesPress}
                onCopySaves={handleCopySaves}
                onUseAsTemplate={handleUseAsTemplate}
              />
            ) : null}
          </div>
        </Tab>

        <Tab
          key="invites"
          title={<InvitesTabTitle pendingCount={pendingInvites.length} statsLoading={invitesStatsLoading} />}>
          <FriendsInvitesTab
            inviteeUserIdInput={inviteeUserIdInput}
            setInviteeUserIdInput={setInviteeUserIdInput}
            inviteTokenInput={inviteTokenInput}
            setInviteTokenInput={setInviteTokenInput}
            inviteBusy={inviteBusy}
            pendingInvites={pendingInvites}
            hostMemberships={hostMemberships}
            memberMemberships={memberMemberships}
            refreshInvitesState={refreshInvitesState}
            handleCreateInvite={handleCreateInvite}
            handleAcceptInviteByToken={handleAcceptInviteByToken}
            handleRespondInvite={handleRespondInvite}
            handleLeaveMembership={handleLeaveMembership}
            handleRemoveMember={handleRemoveMember}
            handleUseHostCloud={handleUseHostCloud}
            activeCloudHostUserId={activeCloudHostUserId}
            lastCreatedInviteToken={lastCreatedInviteToken}
            handleCopyLastToken={handleCopyLastToken}
            invitesStatsLoading={invitesStatsLoading}
            onViewCloudPeerProfile={(userId) => {
              setFriendsTab("user");
              void loadFriendProfileById(userId);
            }}
            ourConfig={ourConfig}
          />
        </Tab>
      </Tabs>

      <AddFriendGamesModal
        isOpen={addFriendGamesOpen}
        onClose={() => setAddFriendGamesOpen(false)}
        friendGames={friendConfig?.games ?? []}
        ourGameIds={ourGameIds}
        onAdded={invalidateConfig}
      />
      <FriendGameTemplateModal isOpen={templateOpen} game={templateGame} onClose={() => setTemplateOpen(false)} />
      <ShareLinkImportConfirmModal
        isOpen={!!shareLinkPreview}
        onClose={() => setShareLinkPreview(null)}
        gameId={shareLinkPreview?.gameId ?? ""}
        gameDisplayName={shareLinkPreview?.gameName}
        files={shareLinkPreview?.files ?? []}
        onConfirm={handleConfirmShareLinkImport}
        isLoading={shareLinkConfirmLoading}
      />
      <CopyFriendSavesConfirmModal
        isOpen={!!copyConfirmPreview}
        onClose={() => setCopyConfirmPreview(null)}
        gameId={copyConfirmPreview?.gameId ?? ""}
        gameDisplayName={copyConfirmPreview?.gameDisplayName}
        imageUrl={copyConfirmPreview?.imageUrl}
        steamAppId={copyConfirmPreview?.steamAppId}
        items={
          copyConfirmPreview?.plan.map((p) => ({
            filename: p.filename,
            targetFilename: p.targetFilename,
          })) ?? []
        }
        newCount={copyConfirmPreview?.newCount ?? 0}
        conflictCount={copyConfirmPreview?.conflictCount ?? 0}
        onConfirm={handleConfirmCopySaves}
        isLoading={copyConfirmPreview ? copyingGameId === copyConfirmPreview.gameId : false}
      />
    </div>
  );
}
