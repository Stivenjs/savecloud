import { useEffect, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, Textarea } from "@heroui/react";
import { FolderOpen, Sparkles } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { addGame } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";
import { toastError, toastSuccess } from "@utils/toast";

interface FriendGameTemplateModalProps {
  isOpen: boolean;
  game: ConfiguredGame | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function FriendGameTemplateModal({ isOpen, game, onClose, onCreated }: FriendGameTemplateModalProps) {
  const { t } = useTranslation();
  const [gameId, setGameId] = useState("");
  const [path, setPath] = useState("");
  const [editionLabel, setEditionLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [steamAppId, setSteamAppId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (game && isOpen) {
      setGameId(game.id);
      setPath("");
      setEditionLabel(game.editionLabel ?? "");
      setSourceUrl(game.sourceUrl ?? "");
      setSteamAppId(game.steamAppId ?? "");
    }
  }, [game, isOpen]);

  const displayName = game ? formatGameDisplayName(game.id) : "";

  const handleBrowsePath = async () => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: t("friends.templateModal.browseTitle"),
      });
      if (typeof result === "string") {
        setPath(result);
      }
    } catch (e) {
      // Error silencioso; si falla el diálogo, el usuario siempre puede escribir la ruta.
    }
  };

  const handleSubmit = async () => {
    const trimmedId = gameId.trim();
    const trimmedPath = path.trim();
    if (!trimmedId || !trimmedPath) {
      toastError(t("friends.templateModal.errorMissing"), t("friends.templateModal.errorMissingDesc"));
      return;
    }
    setSaving(true);
    try {
      await addGame(trimmedId, [trimmedPath], editionLabel, sourceUrl, steamAppId);
      toastSuccess(t("friends.templateModal.successTitle"), t("friends.templateModal.successDesc", { id: trimmedId }));
      onCreated?.();
      onClose();
    } catch (e) {
      toastError(
        t("friends.templateModal.errorCreate"),
        e instanceof Error ? e.message : t("friends.templateModal.errorCreateDesc")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="center"
      size="lg">
      <ModalContent className="overflow-hidden">
        {/* Header Hero con carátula del juego */}
        {game ? (
          <div className="relative border-b border-default-200/60 bg-default-100/40 p-4 dark:bg-default-50/5">
            <div className="flex items-center gap-3.5">
              <PlayingGameThumbnail
                gameId={game.id}
                gameName={displayName}
                imageUrl={game.imageUrl}
                steamAppId={game.steamAppId}
                size="lg"
                className="h-13 w-22 shrink-0 rounded-lg shadow-md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles size={14} />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {t("friends.templateModal.title")}
                  </span>
                </div>
                <h2 className="mt-0.5 truncate text-lg font-bold text-foreground">{displayName}</h2>
                {game.id.toLowerCase() !== displayName.toLowerCase() && (
                  <p className="truncate font-mono text-[11px] text-default-400">{game.id}</p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <ModalBody className="gap-3.5 pt-4">
          {game ? (
            <>
              <p className="text-xs text-default-500">{t("friends.templateModal.desc")}</p>
              <Input
                label={t("friends.templateModal.gameIdLabel")}
                placeholder={t("friends.templateModal.placeholder")}
                value={gameId}
                onValueChange={setGameId}
                variant="bordered"
                size="sm"
              />
              <Input
                label={t("friends.templateModal.pathLabel")}
                placeholder={t("friends.templateModal.pathPlaceholder")}
                value={path}
                onValueChange={setPath}
                variant="bordered"
                size="sm"
                endContent={
                  <button
                    type="button"
                    onClick={handleBrowsePath}
                    className="flex items-center justify-center text-default-400 hover:text-default-700"
                    aria-label={t("friends.templateModal.pathLabel")}>
                    <FolderOpen size={16} />
                  </button>
                }
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label={t("friends.templateModal.editionLabel")}
                  placeholder={t("friends.templateModal.editionPlaceholder")}
                  value={editionLabel}
                  onValueChange={setEditionLabel}
                  variant="bordered"
                  size="sm"
                />
                <Input
                  label={t("friends.templateModal.steamAppIdLabel")}
                  placeholder={t("friends.templateModal.steamPlaceholder")}
                  value={steamAppId}
                  onValueChange={setSteamAppId}
                  variant="bordered"
                  size="sm"
                />
              </div>
              <Input
                label={t("friends.templateModal.sourceUrlLabel")}
                placeholder={t("friends.templateModal.sourcePlaceholder")}
                type="url"
                value={sourceUrl}
                onValueChange={setSourceUrl}
                variant="bordered"
                size="sm"
              />
              <Textarea
                label={t("friends.templateModal.summaryLabel")}
                readOnly
                variant="bordered"
                minRows={2}
                className="text-xs"
                value={
                  `${t("friends.templateModal.friendGamePrefix")}: ${game.id}\n` +
                  `${t("friends.templateModal.friendPathsPrefix")}: ${game.paths.join(", ")}`
                }
              />
            </>
          ) : (
            <p className="text-sm text-default-500">{t("friends.templateModal.noGameSelected")}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={handleSubmit}
            isLoading={saving}
            isDisabled={!game}
            className="font-semibold shadow-sm">
            {t("friends.templateModal.createButton")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
