import { Button, Dropdown, DropdownTrigger } from "@heroui/react";
import { ChevronDown, Film, Gamepad2, Network, Play } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameActionsMenuModelProps } from "@features/games/game-actions";
import { GameActionsDropdownMenu } from "@features/games/game-actions";
import { useTranslation } from "react-i18next";

export type GameDetailActionsProps = Omit<GameActionsMenuModelProps, "surface"> & {
  /** Lanza el archivo configurado en el drawer (Ejecución). Deshabilitado si no hay ruta. */
  onPlay?: (game: ConfiguredGame) => void;
  /** Indica si la app está en proceso de lanzar el juego (esperando respuesta del backend/SO). */
  isStartingPlay?: boolean;
  /** Abre el mapa visual del juego. */
  onOpenGraph?: (game: ConfiguredGame) => void;
};

export function GameDetailActions({
  game,
  isGameRunning,
  isStartingPlay,
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
  const playDisabled = !canPlay || Boolean(isGameRunning) || Boolean(isStartingPlay);
  const playTitle = !canPlay
    ? t("library.gameDetailActions.configureExecutable")
    : isGameRunning
      ? t("library.gameDetailActions.gameRunning")
      : undefined;

  const getPlayButtonContent = () => {
    if (isStartingPlay) {
      return {
        label: t("library.starting"),
        icon: undefined,
        isLoading: true,
        color: "primary" as const,
        variant: "solid" as const,
      };
    }
    if (isGameRunning) {
      return {
        label: t("library.running"),
        icon: <Gamepad2 size={18} />,
        isLoading: false,
        color: "success" as const,
        variant: "flat" as const,
      };
    }
    return {
      label: t("library.launch"),
      icon: <Play size={18} />,
      isLoading: false,
      color: "primary" as const,
      variant: "solid" as const,
    };
  };

  const playConfig = getPlayButtonContent();

  const hasActions = Boolean(
    menuProps.onEdit ||
    menuProps.onRemove ||
    menuProps.onOpenFolder ||
    menuProps.onRecoverFromCloud ||
    menuProps.onSync ||
    menuProps.onFullBackupUpload ||
    menuProps.onShare ||
    menuProps.onUploadClip ||
    menuProps.onOpenClips ||
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
          color={playConfig.color}
          variant={playConfig.variant}
          isLoading={playConfig.isLoading}
          startContent={playConfig.icon}
          isDisabled={playDisabled}
          title={playTitle}
          onPress={() => onPlay(game)}>
          {playConfig.label}
        </Button>
      )}

      {menuProps.onOpenClips && (
        <Button variant="flat" startContent={<Film size={16} />} onPress={() => menuProps.onOpenClips?.(game)}>
          {t("library.clips")}
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
