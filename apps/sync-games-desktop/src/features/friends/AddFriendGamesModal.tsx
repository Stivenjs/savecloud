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

export function AddFriendGamesModal({
  isOpen,
  onClose,
  friendGames,
  ourGameIds,
  onAdded,
}: AddFriendGamesModalProps) {
  const gamesToOffer = useMemo(
    () =>
      friendGames.filter(
        (g) => g.id && !ourGameIds.has(g.id.toLowerCase())
      ),
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
      toastError("Ninguno seleccionado", "Marca al menos un juego para añadir.");
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
        "Juegos añadidos",
        `Se añadieron ${count} juego${count !== 1 ? "s" : ""} a tu configuración. Revisa las rutas en Configuración si es necesario.`
      );
      onAdded?.();
      onClose();
    } catch (e) {
      toastError(
        "No se pudieron añadir",
        e instanceof Error ? e.message : "Error inesperado"
      );
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
          Añadir juegos de este perfil
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            Se añadirán solo los juegos que aún no tienes. No se modifica tu API
            key ni tu User ID. Revisa las rutas en Configuración después.
          </p>
          {gamesToOffer.length === 0 ? (
            <p className="py-4 text-default-500">
              No hay juegos nuevos que añadir; ya tienes todos los de este
              perfil.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button size="sm" variant="flat" onPress={selectAll}>
                  Marcar todos
                </Button>
                <Button size="sm" variant="flat" onPress={selectNone}>
                  Desmarcar todos
                </Button>
              </div>
              <ScrollShadow className="max-h-[40vh]">
                <div className="flex flex-col gap-2">
                  {gamesToOffer.map((g) => (
                    <Checkbox
                      key={g.id}
                      isSelected={selected.has(g.id)}
                      onValueChange={() => toggle(g.id)}
                    >
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
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={handleAdd}
            isDisabled={gamesToOffer.length === 0 || selected.size === 0}
            isLoading={saving}
          >
            Añadir seleccionados ({selected.size})
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
