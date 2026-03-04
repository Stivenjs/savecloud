import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from "@heroui/react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConfiguredGame } from "@app-types/config";
import { addGame } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";

interface FriendGameTemplateModalProps {
  isOpen: boolean;
  game: ConfiguredGame | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function FriendGameTemplateModal({
  isOpen,
  game,
  onClose,
  onCreated,
}: FriendGameTemplateModalProps) {
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
        title: "Selecciona la carpeta de tus guardados",
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
      toastError(
        "Faltan datos",
        "Necesitas indicar al menos el identificador y una ruta local."
      );
      return;
    }
    setSaving(true);
    try {
      await addGame(
        trimmedId,
        trimmedPath,
        editionLabel,
        sourceUrl,
        steamAppId
      );
      toastSuccess(
        "Juego creado desde plantilla",
        `Se añadió ${trimmedId} usando la configuración del amigo.`
      );
      onCreated?.();
      onClose();
    } catch (e) {
      toastError(
        "No se pudo crear el juego",
        e instanceof Error ? e.message : "Ocurrió un error inesperado"
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
      size="lg"
    >
      <ModalContent>
        <ModalHeader>Usar configuración de amigo como plantilla</ModalHeader>
        <ModalBody className="gap-4">
          {game ? (
            <>
              <p className="text-sm text-default-500">
                Crea un juego en tu configuración copiando los metadatos del
                juego de tu amigo. Solo necesitas ajustar la ruta local donde
                están tus guardados.
              </p>
              <Input
                label="Identificador del juego en tu config"
                placeholder="ej. re4-amigo"
                value={gameId}
                onValueChange={setGameId}
                variant="bordered"
              />
              <Input
                label="Ruta local de tus guardados"
                placeholder="C:\\Users\\TuUsuario\\Saved Games\\MiJuego"
                value={path}
                onValueChange={setPath}
                variant="bordered"
                endContent={
                  <button
                    type="button"
                    onClick={handleBrowsePath}
                    className="flex items-center justify-center text-default-400 hover:text-default-700"
                    aria-label="Buscar carpeta"
                  >
                    <FolderOpen size={16} />
                  </button>
                }
              />
              <Input
                label="Origen / edición"
                placeholder="Steam, Empress, RUNE..."
                value={editionLabel}
                onValueChange={setEditionLabel}
                variant="bordered"
              />
              <Input
                label="URL de descarga (opcional)"
                placeholder="https://..."
                type="url"
                value={sourceUrl}
                onValueChange={setSourceUrl}
                variant="bordered"
              />
              <Input
                label="Steam App ID (opcional)"
                placeholder="ej. 1234560"
                value={steamAppId}
                onValueChange={setSteamAppId}
                variant="bordered"
              />
              <Textarea
                label="Resumen de la plantilla"
                readOnly
                variant="bordered"
                minRows={2}
                value={
                  `Juego del amigo: ${game.id}\n` +
                  `Rutas originales: ${game.paths.join(", ")}`
                }
              />
            </>
          ) : (
            <p className="text-sm text-default-500">
              No hay juego seleccionado.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={handleSubmit}
            isLoading={saving}
            isDisabled={!game}
          >
            Crear juego en mi config
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
