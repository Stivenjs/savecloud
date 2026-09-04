import { Button, Dropdown, DropdownTrigger, Tooltip } from "@heroui/react";
import { Download, Ellipsis, Film, Gamepad2, Network, Play } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameActionsMenuModelProps } from "@features/games/game-actions";
import { GameActionsDropdownMenu } from "@features/games/game-actions";
import { useTranslation } from "react-i18next";

export type GameDetailActionsProps = Omit<GameActionsMenuModelProps, "surface"> & {
  /** Lanza el archivo configurado en el drawer (Ejecución). Deshabilitado si no hay ruta. */
  onPlay?: (game: ConfiguredGame) => void;
  /** Permite instalar el juego si no está instalado o proviene del catálogo. */
  onInstall?: () => void;
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
  onInstall,
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
    if (!canPlay && onInstall) {
      return {
        label: t("library.detail.install", "Instalar"),
        icon: <Download size={20} />,
        isLoading: false,
        color: "primary" as const,
        variant: "solid" as const,
        isInstall: true,
      };
    }
    if (isStartingPlay) {
      return {
        label: t("library.starting"),
        icon: undefined,
        isLoading: true,
        color: "primary" as const,
        variant: "solid" as const,
        isInstall: false,
      };
    }
    if (isGameRunning) {
      return {
        label: t("library.running"),
        icon: <Gamepad2 size={20} />,
        isLoading: false,
        color: "success" as const,
        variant: "flat" as const,
        isInstall: false,
      };
    }
    return {
      label: t("library.launch"),
      icon: <Play size={20} />,
      isLoading: false,
      color: "primary" as const,
      variant: "solid" as const,
      isInstall: false,
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

  const showPrimaryButton = Boolean(onPlay || (onInstall && !canPlay));

  if (!showPrimaryButton && !hasActions) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {showPrimaryButton && (
        <Button
          color={playConfig.color}
          variant={playConfig.variant}
          size="lg"
          isLoading={playConfig.isLoading}
          startContent={playConfig.icon}
          isDisabled={playConfig.isInstall ? false : playDisabled}
          title={playConfig.isInstall ? undefined : playTitle}
          className="h-11 min-w-32 gap-2 px-6 text-sm font-bold shadow-md shadow-primary/20 transition-all duration-200 active:scale-[0.97]"
          onPress={() => (playConfig.isInstall ? onInstall?.() : onPlay?.(game))}>
          {playConfig.label}
        </Button>
      )}

      <div className="flex items-center gap-1">
        {menuProps.onOpenClips && (
          <Tooltip content={t("library.clips")} delay={400} closeDelay={0}>
            <Button
              variant="light"
              isIconOnly
              size="sm"
              className="text-default-500 hover:text-foreground"
              onPress={() => menuProps.onOpenClips?.(game)}>
              <Film size={17} strokeWidth={1.5} />
            </Button>
          </Tooltip>
        )}

        {onOpenGraph && (
          <Tooltip content={t("library.viewMap")} delay={400} closeDelay={0}>
            <Button
              variant="light"
              isIconOnly
              size="sm"
              className="text-default-500 hover:text-foreground"
              onPress={() => onOpenGraph(game)}>
              <Network size={17} strokeWidth={1.5} />
            </Button>
          </Tooltip>
        )}

        {/* Solo mostramos el Dropdown si hay acciones válidas */}
        {hasActions && (
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button variant="light" isIconOnly size="sm" className="text-default-500 hover:text-foreground">
                <Ellipsis size={18} strokeWidth={1.5} />
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
    </div>
  );
}
