import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
} from "@heroui/react";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { addGamesFromFriend } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";
import { formatGameDisplayName } from "@utils/gameImage";

interface AddFriendGamesModalProps {
  isOpen: boolean;
  onClose: () => void;
  friendGames: readonly ConfiguredGame[];
  /** IDs de juegos que ya tenemos en nuestra config (no se muestran para añadir). */
  ourGameIds: Set<string>;
  onAdded?: () => void;
}

export function AddFriendGamesModal({ isOpen, onClose, friendGames, ourGameIds, onAdded }: AddFriendGamesModalProps) {
  const { t } = useTranslation();
  const gamesToOffer = useMemo(
    () => friendGames.filter((g) => g.id && !ourGameIds.has(g.id.toLowerCase())),
    [friendGames, ourGameIds]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && gamesToOffer.length > 0) {
      setSelected(new Set(gamesToOffer.map((g) => g.id)));
    }
  }, [isOpen, gamesToOffer]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(gamesToOffer.map((g) => g.id)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const handleAdd = async () => {
    const toAdd = gamesToOffer.filter((g) => selected.has(g.id));
    if (toAdd.length === 0) {
      toastError(t("friends.addGamesModal.toastNoneSelectedTitle"), t("friends.addGamesModal.toastNoneSelectedDesc"));
      return;
    }
    setSaving(true);
    try {
      const payload = toAdd.map((g) => ({
        id: g.id,
        paths: [...g.paths],
        steamAppId: g.steamAppId,
        imageUrl: g.imageUrl,
        editionLabel: g.editionLabel,
        sourceUrl: g.sourceUrl,
      }));
      const count = await addGamesFromFriend(payload);
      toastSuccess(
        t("friends.addGamesModal.toastSuccessTitle"),
        t("friends.addGamesModal.toastSuccessDesc", { count })
      );
      onAdded?.();
      onClose();
    } catch (e) {
      toastError(t("friends.addGamesModal.toastErrorTitle"), e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <UserPlus size={22} className="text-primary" />
          {t("friends.gamesSection.actions.addGames")}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">{t("friends.addGamesModal.desc")}</p>
          {gamesToOffer.length === 0 ? (
            <p className="py-4 text-default-500">{t("friends.addGamesModal.noNewGames")}</p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button size="sm" variant="flat" onPress={selectAll}>
                  {t("friends.addGamesModal.selectAll")}
                </Button>
                <Button size="sm" variant="flat" onPress={selectNone}>
                  {t("friends.addGamesModal.selectNone")}
                </Button>
              </div>
              <ScrollShadow className="max-h-[40vh]">
                <div className="flex flex-col gap-2">
                  {gamesToOffer.map((g) => (
                    <Checkbox key={g.id} isSelected={selected.has(g.id)} onValueChange={() => toggle(g.id)}>
                      {formatGameDisplayName(g.id)}
                    </Checkbox>
                  ))}
                </div>
              </ScrollShadow>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            color="primary"
            onPress={handleAdd}
            isDisabled={gamesToOffer.length === 0 || selected.size === 0}
            isLoading={saving}>
            {t("friends.addGamesModal.addButton", { count: selected.size })}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
