import { useEffect, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from "@heroui/react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { addGame } from "@services/tauri";
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
      <ModalContent>
        <ModalHeader>{t("friends.templateModal.title")}</ModalHeader>
        <ModalBody className="gap-4">
          {game ? (
            <>
              <p className="text-sm text-default-500">{t("friends.templateModal.desc")}</p>
              <Input
                label={t("friends.templateModal.gameIdLabel")}
                placeholder={t("friends.templateModal.placeholder")}
                value={gameId}
                onValueChange={setGameId}
                variant="bordered"
              />
              <Input
                label={t("friends.templateModal.pathLabel")}
                placeholder="C:\\Users\\TuUsuario\\Saved Games\\MiJuego"
                value={path}
                onValueChange={setPath}
                variant="bordered"
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
              <Input
                label={t("friends.templateModal.editionLabel")}
                placeholder="Steam, Empress, RUNE..."
                value={editionLabel}
                onValueChange={setEditionLabel}
                variant="bordered"
              />
              <Input
                label={t("friends.templateModal.sourceUrlLabel")}
                placeholder="https://..."
                type="url"
                value={sourceUrl}
                onValueChange={setSourceUrl}
                variant="bordered"
              />
              <Input
                label={t("friends.templateModal.steamAppIdLabel")}
                placeholder="ej. 1234560"
                value={steamAppId}
                onValueChange={setSteamAppId}
                variant="bordered"
              />
              <Textarea
                label={t("friends.templateModal.summaryLabel")}
                readOnly
                variant="bordered"
                minRows={2}
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
          <Button color="primary" onPress={handleSubmit} isLoading={saving} isDisabled={!game}>
            {t("friends.templateModal.createButton")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
