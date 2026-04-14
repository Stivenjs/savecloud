import { Button, Dropdown, DropdownTrigger } from "@heroui/react";
import { ChevronDown, Play } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameActionsMenuModelProps } from "@features/games/game-actions";
import { GameActionsDropdownMenu } from "@features/games/game-actions";

export type GameDetailActionsProps = Omit<GameActionsMenuModelProps, "surface"> & {
  /** Lanza el .exe configurado en el drawer (Ejecución). Deshabilitado si no hay ruta. */
  onPlay?: (game: ConfiguredGame) => void;
};

export function GameDetailActions({
  game,
  isGameRunning,
  isUploadTooLarge,
  isSyncing,
  isDownloading,
  isFullBackupUploading,
  onPlay,
  ...menuProps
}: GameDetailActionsProps) {
  const canPlay = Boolean(game.launchExecutablePath?.trim());
  const playDisabled = !canPlay || Boolean(isGameRunning);
  const playTitle = !canPlay
    ? "Configura el ejecutable en la lista de juegos: Editar juego → pestaña Ejecución"
    : isGameRunning
      ? "El juego parece estar en ejecución"
      : undefined;

  const hasActions = Boolean(menuProps.onEdit || menuProps.onRemove || menuProps.onOpenFolder);

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
          Jugar
        </Button>
      )}

      {/* Solo mostramos el Dropdown si hay acciones válidas */}
      {hasActions && (
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button variant="bordered" endContent={<ChevronDown size={16} />}>
              Acciones
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
