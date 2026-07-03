import { Button, Dropdown, DropdownTrigger } from "@heroui/react";
import { ChevronDown, Network, Play } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameActionsMenuModelProps } from "@features/games/game-actions";
import { GameActionsDropdownMenu } from "@features/games/game-actions";
import { useTranslation } from "react-i18next";

export type GameDetailActionsProps = Omit<GameActionsMenuModelProps, "surface"> & {
  /** Lanza el archivo configurado en el drawer (Ejecución). Deshabilitado si no hay ruta. */
  onPlay?: (game: ConfiguredGame) => void;
  /** Abre el mapa visual del juego. */
  onOpenGraph?: (game: ConfiguredGame) => void;
};

export function GameDetailActions({
  game,
  isGameRunning,
  isUploadTooLarge,
  isSyncing,
  isDownloading,
  isFullBackupUploading,
  onPlay,
  onOpenGraph,
  ...menuProps
}: GameDetailActionsProps) {
  const { t } = useTranslation();
  const canPlay = Boolean(game.launchExecutablePath?.trim());
  const playDisabled = !canPlay || Boolean(isGameRunning);
  const playTitle = !canPlay
    ? t("library.gameDetailActions.configureExecutable")
    : isGameRunning
      ? t("library.gameDetailActions.gameRunning")
      : undefined;

  const hasActions = Boolean(
    menuProps.onEdit ||
    menuProps.onRemove ||
    menuProps.onOpenFolder ||
    menuProps.onRecoverFromCloud ||
    menuProps.onSync ||
    menuProps.onFullBackupUpload ||
    menuProps.onShare ||
    onOpenGraph
  );

  if (!onPlay && !hasActions) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Solo mostramos el botón Jugar si la vista padre autorizó la función onPlay */}
      {onPlay && (
        <Button
          color="primary"
          startContent={<Play size={18} />}
          isDisabled={playDisabled}
          title={playTitle}
          onPress={() => onPlay(game)}>
          {t("library.launch")}
        </Button>
      )}

      {onOpenGraph && (
        <Button variant="flat" startContent={<Network size={16} />} onPress={() => onOpenGraph(game)}>
          {t("library.viewMap")}
        </Button>
      )}

      {/* Solo mostramos el Dropdown si hay acciones válidas */}
      {hasActions && (
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button variant="bordered" endContent={<ChevronDown size={16} />}>
              {t("common.actions")}
            </Button>
          </DropdownTrigger>
          <GameActionsDropdownMenu
            surface="detail"
            game={game}
            isGameRunning={isGameRunning}
            isUploadTooLarge={isUploadTooLarge}
            isSyncing={isSyncing}
            isDownloading={isDownloading}
            isFullBackupUploading={isFullBackupUploading}
            {...menuProps}
          />
        </Dropdown>
      )}
    </div>
  );
}
