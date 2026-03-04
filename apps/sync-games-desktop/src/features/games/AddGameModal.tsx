import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ImagePlus, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { addGame, readImageAsDataUrl, searchSteamGames } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";

interface AddGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialPath?: string;
  suggestedId?: string;
}

export function AddGameModal({
  isOpen,
  onClose,
  onSuccess,
  initialPath = "",
  suggestedId = "",
}: AddGameModalProps) {
  const [gameId, setGameId] = useState(suggestedId);
  const [path, setPath] = useState(initialPath);
  const [editionLabel, setEditionLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedSteamAppId, setSelectedSteamAppId] = useState<string | null>(
    null
  );
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setGameId(suggestedId);
      setPath(initialPath);
      setEditionLabel("");
      setSourceUrl("");
      setSearchInput("");
      setSelectedSteamAppId(null);
      setImageUrl("");
    }
  }, [isOpen, suggestedId, initialPath]);

  const handleBrowseFolder = async () => {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta de guardados",
      });
      if (selected && typeof selected === "string") {
        setPath(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenChange = (isOpenModal: boolean) => {
    if (!isOpenModal) {
      setError(null);
      setGameId("");
      setPath("");
      setEditionLabel("");
      setSourceUrl("");
      setSearchInput("");
      setSelectedSteamAppId(null);
      setImageUrl("");
      onClose();
    }
  };

  const handleSelectLocalImage = async () => {
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar portada (imagen)",
        filters: [
          { name: "Imagen", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
        ],
      });
      if (selected && typeof selected === "string") {
        const dataUrl = await readImageAsDataUrl(selected);
        setImageUrl(dataUrl);
        setSelectedSteamAppId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const debouncedSearch = useDebouncedValue(searchInput.trim(), 400);

  const { data: steamResults = [], isLoading: steamLoading } = useQuery({
    queryKey: ["steam-search", debouncedSearch],
    queryFn: () => searchSteamGames(debouncedSearch),
    enabled: debouncedSearch.length >= 3 && isOpen,
  });

  const handleSubmit = async () => {
    const id = gameId.trim();
    const p = path.trim();
    const edition = editionLabel.trim();
    const url = sourceUrl.trim();
    if (!id || !p) {
      setError("Identificador y ruta son obligatorios.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await addGame(
        id,
        p,
        edition || undefined,
        url || undefined,
        selectedSteamAppId || undefined
      );
      onSuccess();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} placement="center">
      <ModalContent>
        <ModalHeader>Añadir juego</ModalHeader>
        <ModalBody className="gap-4">
          <Input
            label="Identificador del juego"
            placeholder="ej. elden-ring"
            value={gameId}
            onValueChange={setGameId}
            description="Un nombre único para identificar el juego (minúsculas, guiones)"
            variant="bordered"
          />
          <Input
            label="Ruta de la carpeta de guardados"
            placeholder="Selecciona una carpeta o escribe la ruta"
            value={path}
            onValueChange={setPath}
            variant="bordered"
            isInvalid={!!error}
            errorMessage={error}
            endContent={
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                aria-label="Seleccionar carpeta"
                onPress={handleBrowseFolder}
              >
                <FolderOpen size={18} />
              </Button>
            }
          />
          <Input
            label="Origen / edición (opcional)"
            placeholder="ej. Steam, Empress, RUNE"
            value={editionLabel}
            onValueChange={setEditionLabel}
            description="Solo informativo, para recordar qué build/crack corresponde a este juego."
            variant="bordered"
          />
          <Input
            label="URL de descarga (opcional)"
            placeholder="Pega el enlace de donde descargaste esta edición"
            value={sourceUrl}
            onValueChange={setSourceUrl}
            variant="bordered"
            type="url"
          />
          <div className="space-y-2">
            <p className="text-xs font-medium text-default-500">
              Portada personalizada{" "}
              <span className="font-normal">
                (opcional; para juegos no-Steam, emuladores, etc.)
              </span>
            </p>
            <Input
              label="URL de la imagen o imagen local"
              placeholder="Pega una URL de imagen o selecciona un archivo"
              value={imageUrl.startsWith("data:") ? "(imagen local seleccionada)" : imageUrl}
              onValueChange={(v) => {
                if (v !== "(imagen local seleccionada)") setImageUrl(v);
              }}
              variant="bordered"
              endContent={
                <Button
                  isIconOnly
                  variant="flat"
                  size="sm"
                  aria-label="Seleccionar imagen local"
                  onPress={handleSelectLocalImage}
                >
                  <ImagePlus size={18} />
                </Button>
              }
            />
          </div>
          <div className="mt-2 space-y-2">
            <p className="text-xs font-medium text-default-500">
              Vincular con juego real (Steam){" "}
              <span className="font-normal">
                (opcional, para portada y rutas más precisas)
              </span>
            </p>
            <Input
              label="Buscar juego en Steam"
              placeholder="Escribe el nombre real, ej. Resident Evil 4"
              value={searchInput}
              onValueChange={(value) => {
                setSearchInput(value);
                setSelectedSteamAppId(null);
              }}
              variant="bordered"
              startContent={<Search size={16} className="text-default-400" />}
            />
            {debouncedSearch.length >= 3 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-medium border border-default-200 bg-default-50 px-2 py-1 text-xs">
                {steamLoading ? (
                  <p className="px-1 py-1 text-default-500">
                    Buscando en Steam...
                  </p>
                ) : steamResults.length === 0 ? (
                  <p className="px-1 py-1 text-default-500">
                    No se encontraron juegos en Steam.
                  </p>
                ) : (
                  steamResults.map((r) => (
                    <button
                      key={r.steamAppId}
                      type="button"
                      onClick={() => {
                        const nextSelected =
                          r.steamAppId === selectedSteamAppId
                            ? null
                            : r.steamAppId;
                        setSelectedSteamAppId(nextSelected);
                        setSearchInput(r.name);
                        setGameId((prev) => {
                          if (prev.trim()) return prev;
                          const slug =
                            r.name
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, "")
                              .slice(0, 80) || "game";
                          return slug;
                        });
                      }}
                      className={`sg-animate-fade-in-up flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-default-100 ${
                        selectedSteamAppId === r.steamAppId
                          ? "bg-primary-50 text-primary-600"
                          : "text-default-600"
                      }`}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="ml-2 text-[10px] text-default-400">
                        #{r.steamAppId}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            {selectedSteamAppId && (
              <p className="text-[11px] text-success">
                Juego de Steam seleccionado (Steam App ID:{" "}
                <span className="font-mono">{selectedSteamAppId}</span>).
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            color="primary"
            onPress={handleSubmit}
            isLoading={loading}
            isDisabled={!gameId.trim() || !path.trim()}
          >
            Añadir
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
