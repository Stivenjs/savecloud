import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Tab, Tabs } from "@heroui/react";
import { Gamepad2, Image, Play } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import {
  addGame,
  renameGame,
  renameGameInCloud,
  scheduleConfigBackupToCloud,
  setGameExecutableNames,
  setGameLaunchExecutable,
  updateGame,
} from "@services/tauri";
import { useGameForm } from "@/hooks/useGameForm";
import { GameDrawerGeneralTab } from "@/features/games/GameDrawerGeneralTab";
import { GameDrawerLaunchTab } from "@/features/games/GameDrawerLaunchTab";
import { GameDrawerMediaTab } from "@/features/games/GameDrawerMediaTab";

interface GameDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode: "add" | "edit";
  game?: ConfiguredGame | null;
  initialPath?: string;
  suggestedId?: string;
}

export function GameDrawer({
  isOpen,
  onClose,
  onSuccess,
  mode,
  game = null,
  initialPath = "",
  suggestedId = "",
}: GameDrawerProps) {
  const { form, setField, resetForm, error, setError, loading, setLoading } = useGameForm({
    isOpen,
    mode,
    game,
    initialPath,
    suggestedId,
  });

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    const id = form.gameId.trim();
    const path = form.path.trim();

    if (!id || !path) {
      setError("Identificador y ruta son obligatorios.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === "add") {
        await addGame(
          id,
          path,
          form.editionLabel.trim() || undefined,
          form.sourceUrl.trim() || undefined,
          form.selectedSteamAppId || undefined,
          form.imageUrl.trim() || undefined
        );
      } else if (game) {
        const idChanged = id !== game.id;
        if (idChanged) {
          await renameGameInCloud(game.id, id);
          await renameGame(game.id, id);
        }

        const paths = [...(game.paths ?? [])];
        if (paths.length > 0) paths[0] = path;
        else paths.push(path);

        await updateGame(
          idChanged ? id : game.id,
          paths,
          form.editionLabel.trim() || undefined,
          form.sourceUrl.trim() || undefined,
          form.selectedSteamAppId ?? undefined,
          form.imageUrl.trim() || undefined
        );
      }

      await setGameLaunchExecutable(id, form.launchExecutablePath.trim() || null);
      await setGameExecutableNames(id, form.executableNames);
      scheduleConfigBackupToCloud();

      onSuccess();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "add" ? "Añadir juego" : "Editar juego";
  const submitLabel = mode === "add" ? "Añadir" : "Guardar cambios";
  const canSubmit = !!form.gameId.trim() && !!form.path.trim();

  return (
    <Drawer isOpen={isOpen} onOpenChange={(open) => !open && handleClose()} placement="right" size="lg">
      <DrawerContent>
        <DrawerHeader className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {mode === "edit" && game && <p className="text-xs text-default-400 truncate">Editando: {game.id}</p>}
        </DrawerHeader>

        <DrawerBody className="px-4">
          <Tabs
            aria-label="Secciones del juego"
            variant="underlined"
            color="primary"
            fullWidth
            classNames={{ panel: "pt-4" }}>
            <Tab
              key="general"
              title={
                <div className="flex items-center gap-1.5">
                  <Gamepad2 size={14} />
                  <span>General</span>
                </div>
              }>
              <GameDrawerGeneralTab form={form} setField={setField} setError={setError} error={error} mode={mode} />
            </Tab>

            <Tab
              key="media"
              title={
                <div className="flex items-center gap-1.5">
                  <Image size={14} />
                  <span>Media</span>
                </div>
              }>
              <GameDrawerMediaTab form={form} setField={setField} setError={setError} isOpen={isOpen} />
            </Tab>

            <Tab
              key="launch"
              title={
                <div className="flex items-center gap-1.5">
                  <Play size={14} />
                  <span>Ejecución</span>
                </div>
              }>
              <GameDrawerLaunchTab form={form} setField={setField} setError={setError} isOpen={isOpen} />
            </Tab>
          </Tabs>

          {error && (
            <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="flat" onPress={handleClose}>
            Cancelar
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} isDisabled={!canSubmit}>
            {submitLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
