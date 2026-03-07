import { Card, CardBody, Spinner } from "@heroui/react";
import { Users } from "lucide-react";
import { useFriendsPage } from "@features/friends/useFriendsPage";
import { AddFriendGamesModal } from "@features/friends/AddFriendGamesModal";
import { FriendGameTemplateModal } from "@features/friends/FriendGameTemplateModal";
import { FriendGamesSection } from "@features/friends/FriendGamesSection";
import { FriendProfileCard } from "@features/friends/FriendProfileCard";
import { ShareLinkCard } from "@features/friends/ShareLinkCard";
import { ShareLinkImportConfirmModal } from "@features/friends/ShareLinkImportConfirmModal";
import { CopyFriendSavesConfirmModal } from "@features/friends/CopyFriendSavesConfirmModal";

export function FriendsPage() {
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
  } = useFriendsPage();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Amigos</h1>
        <span className="inline-flex h-7 items-center rounded-full bg-default-100 px-3 text-xs text-default-500">
          Importar desde link o ver perfil por User ID
        </span>
      </div>

      {/* 1. Importar desde link compartido */}
      <ShareLinkCard
        shareLinkInput={shareLinkInput}
        onShareLinkChange={setShareLinkInput}
        onImportPress={handleImportFromShareLink}
        loading={shareLinkLoading}
        disabled={!ourConfig?.apiBaseUrl?.trim()}
      />

      {/* 2. Ver perfil por User ID */}
      <FriendProfileCard
        friendIdInput={friendIdInput}
        onFriendIdChange={setFriendIdInput}
        onLoadPress={handleLoadFriend}
        loading={loading}
        error={error}
      />

      {!friendConfig && !loading && !error && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <Users size={40} className="text-default-400" />
            <p className="text-default-500">
              Introduce el userId de un amigo para ver sus juegos y
              configuración.
            </p>
          </CardBody>
        </Card>
      )}

      {loading && (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500">Cargando perfil del amigo...</p>
        </div>
      )}

      {friendConfig && !loading && (
        <FriendGamesSection
          userIdDisplay={friendConfig.userId ?? "(sin userId en config)"}
          summaries={summaries}
          copyingGameId={copyingGameId}
          onAddGamesPress={() => setAddFriendGamesOpen(true)}
          onCopySaves={handleCopySaves}
          onUseAsTemplate={(game) => setTemplateGame(game)}
        />
      )}

      <AddFriendGamesModal
        isOpen={addFriendGamesOpen}
        onClose={() => setAddFriendGamesOpen(false)}
        friendGames={friendConfig?.games ?? []}
        ourGameIds={ourGameIds}
        onAdded={invalidateConfig}
      />
      <FriendGameTemplateModal
        isOpen={templateOpen}
        game={templateGame}
        onClose={() => setTemplateOpen(false)}
      />

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
        isLoading={
          copyConfirmPreview
            ? copyingGameId === copyConfirmPreview.gameId
            : false
        }
      />
    </div>
  );
}
