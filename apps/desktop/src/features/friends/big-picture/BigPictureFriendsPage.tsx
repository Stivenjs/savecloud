import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Spinner, Tab, Tabs } from "@heroui/react";
import { Link2, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { useFriendsPage } from "@/hooks/useFriendsPage";
import { AddFriendGamesModal } from "@features/friends/AddFriendGamesModal";
import { FriendGameTemplateModal } from "@features/friends/FriendGameTemplateModal";
import { FriendGamesSection } from "@features/friends/FriendGamesSection";
import { ShareLinkImportConfirmModal } from "@features/friends/ShareLinkImportConfirmModal";
import { CopyFriendSavesConfirmModal } from "@features/friends/CopyFriendSavesConfirmModal";
import { FriendsInvitesTab, InvitesTabTitle } from "@features/friends/FriendsInvitesTab";
import {
  consumePendingFriendProfileUserId,
  onRequestOpenFriendProfile,
} from "@features/friends/friendProfileNavigation";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import { listCloudPresence } from "@services/tauri/invites.service";
import { visibilityManager } from "@hooks/useAppVisibility";
import { BigPictureFriendsHeader } from "./BigPictureFriendsHeader";
import { BigPictureShareLinkSection } from "./BigPictureShareLinkSection";
import { BigPictureFriendSearchSection } from "./BigPictureFriendSearchSection";

type FriendsTabKey = "link" | "user" | "invites";

/**
 * Versión Big Picture (modo consola) de la página Social.
 *
 * Componentes específicos para consola en cada tab, CSS scope
 * para escalar sub-componentes reutilizados, y navegación atrás
 * que vuelve a la biblioteca (como en SteamCatalogPage BP).
 */
export function BigPictureFriendsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [friendsTab, setFriendsTab] = useState<FriendsTabKey>(() => {
    try {
      return (sessionStorage.getItem("friendsPageTab") as FriendsTabKey) || "link";
    } catch {
      return "link";
    }
  });

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
      if (!visibilityManager.isVisible) return;
      void refreshInvitesState();
    }, 30000);

    return () => window.clearInterval(id);
  }, [friendsTab, refreshInvitesState]);

  useRegisterGlobalBack(() => {
    if (copyConfirmPreview) {
      setCopyConfirmPreview(null);
      return true;
    }
    if (shareLinkPreview) {
      setShareLinkPreview(null);
      return true;
    }
    if (templateOpen) {
      setTemplateOpen(false);
      setTemplateGame(null);
      return true;
    }
    if (addFriendGamesOpen) {
      setAddFriendGamesOpen(false);
      return true;
    }

    navigate("/");
    return true;
  });

  return (
    <div className="space-y-5 pb-32">
      <BigPictureFriendsHeader pendingInvitesCount={pendingInvites.length} />

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
        size="lg"
        classNames={{
          panel: "pt-6",
          tabList: "gap-6",
          tab: "text-base md:text-lg font-semibold px-1 py-3",
          cursor: "h-[3px]",
        }}>
        {/* ────── Tab: Importar por link ────── */}
        <Tab
          key="link"
          title={
            <div className="flex items-center gap-2.5">
              <Link2 className="h-5 w-5" />
              <span>{t("friends.tabs.importLink")}</span>
            </div>
          }>
          <BigPictureShareLinkSection
            shareLinkInput={shareLinkInput}
            onShareLinkChange={setShareLinkInput}
            onImportPress={handleImportFromShareLink}
            loading={shareLinkLoading}
            disabled={!ourConfig?.apiBaseUrl?.trim()}
          />
        </Tab>

        {/* ────── Tab: Buscar por usuario ────── */}
        <Tab
          key="user"
          title={
            <div className="flex items-center gap-2.5">
              <UserRound className="h-5 w-5" />
              <span>{t("friends.tabs.searchUser")}</span>
            </div>
          }>
          <div className="space-y-6">
            <BigPictureFriendSearchSection
              friendIdInput={friendIdInput}
              onFriendIdChange={setFriendIdInput}
              onLoadPress={handleLoadFriend}
              loading={loading}
              error={error}
            />
            {loading ? (
              <div className="flex min-h-[20vh] flex-col items-center justify-center gap-4">
                <Spinner size="lg" color="primary" />
                <p className="text-base text-default-500">{t("friends.loadingProfile")}</p>
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

        {/* ────── Tab: Invitaciones (CSS scope para escalar componentes) ────── */}
        <Tab
          key="invites"
          title={<InvitesTabTitle pendingCount={pendingInvites.length} statsLoading={invitesStatsLoading} />}>
          <div className="sm-bp-console-scope">
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
          </div>
        </Tab>
      </Tabs>

      {/* ── Modales (reutilizados tal cual) ── */}
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
