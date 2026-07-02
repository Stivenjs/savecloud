import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Tab, Tabs } from "@heroui/react";
import { Gamepad2, Image, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { toGameId } from "@utils/gameImage";
import { dedupePreserveGamePaths } from "@utils/gameSavePaths";
import {
  addGame,
  renameGame,
  renameGameInCloud,
  scheduleConfigBackupToCloud,
  setGameExecutableNames,
  setGameLaunchExecutable,
  updateGame,
} from "@services/tauri";
import { STABLE_EMPTY_GAME_PATHS, useGameForm } from "@/hooks/useGameForm";
import { GameDrawerGeneralTab } from "@/features/games/GameDrawerGeneralTab";
import { GameDrawerLaunchTab } from "@/features/games/GameDrawerLaunchTab";
import { GameDrawerMediaTab } from "@/features/games/GameDrawerMediaTab";

interface GameDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode: "add" | "edit";
  game?: ConfiguredGame | null;
  initialPaths?: string[];
  suggestedId?: string;
}

export function GameDrawer({
  isOpen,
  onClose,
  onSuccess,
  mode,
  game = null,
  initialPaths = STABLE_EMPTY_GAME_PATHS,
  suggestedId = "",
}: GameDrawerProps) {
  const { t } = useTranslation();
  const { form, setField, resetForm, error, setError, loading, setLoading, isDirty } = useGameForm({
    isOpen,
    mode,
    game,
    initialPaths,
    suggestedId,
  });

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    const rawName = form.gameId.trim();
    const paths = dedupePreserveGamePaths(form.paths);

    if (!rawName) {
      setError(t("library.gameDrawer.nameRequired"));
      return;
    }

    const finalId = toGameId(rawName);

    setLoading(true);
    setError(null);

    try {
      if (mode === "add") {
        await addGame(
          finalId,
          paths,
          form.editionLabel.trim() || undefined,
          form.sourceUrl.trim() || undefined,
          form.selectedSteamAppId || undefined,
          form.imageUrl.trim() || undefined
        );
      } else if (game) {
        const idChanged = finalId !== game.id;
        if (idChanged) {
          await renameGameInCloud(game.id, finalId);
          await renameGame(game.id, finalId);
        }

        await updateGame(
          idChanged ? finalId : game.id,
          paths,
          form.editionLabel.trim() || undefined,
          form.sourceUrl.trim() || undefined,
          form.selectedSteamAppId ?? undefined,
          form.imageUrl.trim() || undefined
        );
      }

      await setGameLaunchExecutable(finalId, form.launchExecutablePath.trim() || null);
      await setGameExecutableNames(finalId, form.executableNames);
      scheduleConfigBackupToCloud();

      onSuccess();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "add" ? t("library.gameDrawer.addTitle") : t("library.gameDrawer.editTitle");
  const submitLabel = mode === "add" ? t("library.gameDrawer.addButton") : t("library.gameDrawer.saveChanges");
  const canSubmit = !!form.gameId.trim() && isDirty;

  return (
    <Drawer isOpen={isOpen} onOpenChange={(open) => !open && handleClose()} placement="right" size="lg">
      <DrawerContent>
        <DrawerHeader className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {mode === "edit" && game && (
            <p className="text-xs text-default-400 truncate">{t("library.gameDrawer.editing", { gameId: game.id })}</p>
          )}
        </DrawerHeader>

        <DrawerBody className="px-4">
          <Tabs
            aria-label={t("library.gameDrawer.tabsAriaLabel")}
            variant="underlined"
            color="primary"
            fullWidth
            classNames={{ panel: "pt-4" }}>
            <Tab
              key="general"
              title={
                <div className="flex items-center gap-1.5">
                  <Gamepad2 size={14} />
                  <span>{t("library.gameDrawer.tabGeneral")}</span>
                </div>
              }>
              <GameDrawerGeneralTab form={form} setField={setField} setError={setError} error={error} mode={mode} />
            </Tab>

            <Tab
              key="media"
              title={
                <div className="flex items-center gap-1.5">
                  <Image size={14} />
                  <span>{t("library.gameDrawer.tabMedia")}</span>
                </div>
              }>
              <GameDrawerMediaTab form={form} setField={setField} setError={setError} isOpen={isOpen} />
            </Tab>

            <Tab
              key="launch"
              title={
                <div className="flex items-center gap-1.5">
                  <Play size={14} />
                  <span>{t("library.gameDrawer.tabLaunch")}</span>
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
            {t("common.cancel")}
          </Button>
          <Button color="primary" onPress={handleSubmit} isLoading={loading} isDisabled={!canSubmit}>
            {submitLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
