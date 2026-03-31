import { useCallback, useState } from "react";
import { Button, Input, Spinner, Tab, Tabs } from "@heroui/react";
import type { ConfiguredGame } from "@app-types/config";
import { useFriendsPage } from "@features/friends/useFriendsPage";
import { AddFriendGamesModal } from "@features/friends/AddFriendGamesModal";
import { FriendGameTemplateModal } from "@features/friends/FriendGameTemplateModal";
import { FriendGamesSection } from "@features/friends/FriendGamesSection";
import { FriendProfileCard } from "@features/friends/FriendProfileCard";
import { ShareLinkCard } from "@features/friends/ShareLinkCard";
import { ShareLinkImportConfirmModal } from "@features/friends/ShareLinkImportConfirmModal";
import { CopyFriendSavesConfirmModal } from "@features/friends/CopyFriendSavesConfirmModal";
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
  } = useFriendsPage();

  const handleAddGamesPress = useCallback(() => setAddFriendGamesOpen(true), [setAddFriendGamesOpen]);
  const handleUseAsTemplate = useCallback((game: ConfiguredGame) => setTemplateGame(game), [setTemplateGame]);

  const handleOpenInvites = useCallback(() => {
    setFriendsTab("invites");
    void refreshInvitesState();
  }, [refreshInvitesState]);

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
          <h1 className="text-2xl font-semibold">Amigos</h1>
          <span className="inline-flex h-7 items-center rounded-full bg-default-100 px-3 text-xs text-default-500">
            Importar desde link o ver perfil por User ID
          </span>
        </div>
        <p className="max-w-3xl text-sm text-default-600">
          Usa <strong className="text-foreground">Importar por link</strong> si te pasaron un enlace de compartir, o{" "}
          <strong className="text-foreground">Buscar por User ID</strong> para cargar el perfil de un amigo de
          confianza.
        </p>
      </div>

      <Tabs
        selectedKey={friendsTab}
        onSelectionChange={(k) => setFriendsTab((String(k) as FriendsTabKey) || "link")}
        variant="underlined"
        classNames={{ panel: "pt-4" }}>
        <Tab key="link" title="Importar por link">
          <ShareLinkCard
            shareLinkInput={shareLinkInput}
            onShareLinkChange={setShareLinkInput}
            onImportPress={handleImportFromShareLink}
            loading={shareLinkLoading}
            disabled={!ourConfig?.apiBaseUrl?.trim()}
          />
        </Tab>
        <Tab key="user" title="Buscar por User ID">
          <FriendProfileCard
            friendIdInput={friendIdInput}
            onFriendIdChange={setFriendIdInput}
            onLoadPress={handleLoadFriend}
            loading={loading}
            error={error}
          />
        </Tab>
        <Tab key="invites" title="Invitaciones">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Input
                label="Invitar por userId (opcional)"
                placeholder="user-123"
                value={inviteeUserIdInput}
                onValueChange={setInviteeUserIdInput}
              />
              <Button color="primary" isLoading={inviteBusy} onPress={handleCreateInvite}>
                Crear invitación
              </Button>
            </div>
            <div className="grid gap-2">
              <Input
                label="Aceptar por token"
                placeholder="pega token de invitación"
                value={inviteTokenInput}
                onValueChange={setInviteTokenInput}
              />
              <Button variant="flat" isLoading={inviteBusy} onPress={handleAcceptInviteByToken}>
                Aceptar invitación por token
              </Button>
            </div>
            <div className="rounded-xl border border-default-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Pendientes para ti</p>
                <Button size="sm" variant="light" onPress={() => void refreshInvitesState()}>
                  Refrescar
                </Button>
              </div>
              <div className="space-y-2">
                {pendingInvites.length === 0 ? (
                  <p className="text-sm text-default-500">No tienes invitaciones pendientes.</p>
                ) : (
                  pendingInvites.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-default-200 p-2 text-sm">
                      <p>
                        Anfitrión: <strong>{invite.hostUserId}</strong>
                      </p>
                      <p className="text-default-500">Expira: {new Date(invite.expiresAt).toLocaleString()}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" color="success" onPress={() => void handleRespondInvite(invite.id, "accept")}>
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant="flat"
                          onPress={() => void handleRespondInvite(invite.id, "reject")}>
                          Rechazar
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-xl border border-default-200 p-3">
              <p className="mb-2 text-sm font-medium">Nube activa para sincronización</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={activeCloudHostUserId ? "flat" : "solid"}
                  color={activeCloudHostUserId ? "default" : "primary"}
                  onPress={() => void handleUseHostCloud(null)}>
                  Usar mi nube
                </Button>
                {memberMemberships.map((m) => (
                  <Button
                    key={`active-${m.hostUserId}`}
                    size="sm"
                    variant={activeCloudHostUserId === m.hostUserId ? "solid" : "flat"}
                    color={activeCloudHostUserId === m.hostUserId ? "primary" : "default"}
                    onPress={() => void handleUseHostCloud(m.hostUserId)}>
                    {`Usar nube de ${m.hostUserId}`}
                  </Button>
                ))}
              </div>
              <p className="mb-2 text-sm font-medium">Nubes que usas como miembro</p>
              <div className="space-y-2">
                {memberMemberships.length === 0 ? (
                  <p className="text-sm text-default-500">No perteneces a ninguna nube compartida.</p>
                ) : (
                  memberMemberships.map((m) => (
                    <div key={`${m.hostUserId}-${m.memberUserId}`} className="flex items-center justify-between gap-2">
                      <p className="text-sm">
                        Host: <strong>{m.hostUserId}</strong>
                      </p>
                      <Button
                        size="sm"
                        variant="flat"
                        color="warning"
                        onPress={() => void handleLeaveMembership(m.hostUserId)}>
                        Salir
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-xl border border-default-200 p-3">
              <p className="mb-2 text-sm font-medium">Miembros en tu nube (host)</p>
              <div className="space-y-2">
                {hostMemberships.length === 0 ? (
                  <p className="text-sm text-default-500">No tienes miembros activos en tu nube.</p>
                ) : (
                  hostMemberships.map((m) => (
                    <div key={`${m.hostUserId}-${m.memberUserId}`} className="flex items-center justify-between gap-2">
                      <p className="text-sm">
                        Miembro: <strong>{m.memberUserId}</strong>
                      </p>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        onPress={() => void handleRemoveMember(m.memberUserId)}>
                        Eliminar
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Tab>
      </Tabs>
      <div className="flex justify-end">
        <Button size="sm" variant="light" onPress={handleOpenInvites}>
          Gestionar invitaciones
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500">Cargando perfil del amigo...</p>
        </div>
      ) : null}

      {friendConfig && !loading ? (
        <FriendGamesSection
          userIdDisplay={friendConfig.userId ?? "(sin userId en config)"}
          summaries={summaries}
          copyingGameId={copyingGameId}
          onAddGamesPress={handleAddGamesPress}
          onCopySaves={handleCopySaves}
          onUseAsTemplate={handleUseAsTemplate}
        />
      ) : null}

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
