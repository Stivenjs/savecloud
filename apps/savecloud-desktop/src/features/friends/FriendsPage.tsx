import { useCallback, useEffect, useState } from "react";
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
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";

type FriendsTabKey = "link" | "user" | "invites";
export function FriendsPage() {
  const [friendsTab, setFriendsTab] = useState<FriendsTabKey>("link");
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
  } = useFriendsPage();

  const handleAddGamesPress = useCallback(() => setAddFriendGamesOpen(true), [setAddFriendGamesOpen]);
  const handleUseAsTemplate = useCallback((game: ConfiguredGame) => setTemplateGame(game), [setTemplateGame]);

  useEffect(() => {
    if (friendsTab !== "invites") return;

    void refreshInvitesState();
    const id = window.setInterval(() => {
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
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Amigos</h1>
          <Chip size="sm" variant="flat" color="default" className="text-xs">
            Importar desde enlace o ver perfil por usuario
          </Chip>
        </div>
        <p className="max-w-3xl text-sm text-default-500">
          Usa <strong className="text-foreground">Importar por link</strong> si te pasaron un enlace de compartir, o{" "}
          <strong className="text-foreground">Buscar por usuario</strong> para cargar el perfil de un amigo de
          confianza.
        </p>
      </div>

      {/* Tabs */}
      <Tabs
        selectedKey={friendsTab}
        onSelectionChange={(k) => {
          const nextTab = (String(k) as FriendsTabKey) || "link";
          setFriendsTab(nextTab);
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
              <span>Importar por link</span>
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
              <span>Buscar por usuario</span>
            </div>
          }>
          <FriendProfileCard
            friendIdInput={friendIdInput}
            onFriendIdChange={setFriendIdInput}
            onLoadPress={handleLoadFriend}
            loading={loading}
            error={error}
          />
        </Tab>

        <Tab key="invites" title={<InvitesTabTitle pendingCount={pendingInvites.length} />}>
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
          />
        </Tab>
      </Tabs>

      {/* Loading state */}
      {loading ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500">Cargando perfil del amigo...</p>
        </div>
      ) : null}

      {/* Friend games */}
      {friendConfig && !loading ? (
        <FriendGamesSection
          userIdDisplay={friendConfig.userId ?? "(sin usuario en config)"}
          summaries={summaries}
          copyingGameId={copyingGameId}
          onAddGamesPress={handleAddGamesPress}
          onCopySaves={handleCopySaves}
          onUseAsTemplate={handleUseAsTemplate}
        />
      ) : null}

      {/* Modals */}
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
