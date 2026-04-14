import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@heroui/react";
import { Download } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { useGameForm } from "@/hooks/useGameForm";
import { GameDrawerTorrentTab } from "@/features/games/GameDrawerTorrentTab";

interface GameTorrentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  /** Si false, no se consultan torrents en la nube (sin cuenta sync). */
  cloudEnabled?: boolean;
}

export function GameTorrentDrawer({ isOpen, onClose, game, cloudEnabled = true }: GameTorrentDrawerProps) {
  const { form, setField, resetForm, error, setError } = useGameForm({
    isOpen,
    mode: "edit",
    game,
  });

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Drawer isOpen={isOpen} onOpenChange={(open) => !open && handleClose()} placement="right" size="lg">
      <DrawerContent>
        <DrawerHeader className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Download size={20} aria-hidden />
            Torrent
          </h2>
          {game && <p className="truncate text-xs text-default-400">{game.id}</p>}
        </DrawerHeader>

        <DrawerBody className="px-4">
          {game && (
            <GameDrawerTorrentTab
              form={form}
              setField={setField}
              setError={setError}
              gameId={form.gameId}
              savePath={form.path}
              mode="edit"
              cloudEnabled={cloudEnabled}
            />
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="flat" onPress={handleClose}>
            Cerrar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
