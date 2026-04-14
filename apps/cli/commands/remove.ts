import { select, confirm, Separator } from "@inquirer/prompts";
import figures from "figures";
import type { CliDeps } from "@cli/container";

const CANCEL_OPTION = "__cancel__";
const REMOVE_ALL = "__remove_all__";

export async function runRemoveInteractive(deps: CliDeps): Promise<void> {
  const games = await deps.listGamesUseCase.execute();

  if (games.length === 0) {
    console.log("\nNo hay juegos configurados para eliminar.\n");
    return;
  }

  const gameChoices = [
    ...games.map((g) => ({
      name: `${g.id}  (${g.paths.length} ruta${g.paths.length > 1 ? "s" : ""})`,
      value: g.id,
    })),
    new Separator(),
    { name: `${figures.arrowLeft} Cancelar`, value: CANCEL_OPTION },
  ];

  const selectedGameId = await select<string>({
    message: "¿Qué juego quieres eliminar?",
    pageSize: 12,
    choices: gameChoices,
  });

  if (selectedGameId === CANCEL_OPTION) return;

  const game = games.find((g) => g.id === selectedGameId)!;

  if (game.paths.length === 1) {
    const sure = await confirm({
      message: `¿Eliminar "${game.id}" y su ruta?\n  → ${game.paths[0]}`,
      default: false,
    });
    if (!sure) return;

    const result = await deps.removeGameUseCase.execute({
      gameId: game.id,
    });
    printResult(game.id, result);
    return;
  }

  const pathChoices = [
    {
      name: `${figures.cross} Eliminar el juego completo (todas las rutas)`,
      value: REMOVE_ALL,
    },
    new Separator(`── Rutas de ${game.id} ──`),
    ...game.paths.map((p) => ({ name: `→ ${p}`, value: p })),
    new Separator(),
    { name: `${figures.arrowLeft} Cancelar`, value: CANCEL_OPTION },
  ];

  const selectedPath = await select<string>({
    message: `"${game.id}" tiene ${game.paths.length} rutas. ¿Qué quieres eliminar?`,
    pageSize: 12,
    choices: pathChoices,
  });

  if (selectedPath === CANCEL_OPTION) return;

  if (selectedPath === REMOVE_ALL) {
    const sure = await confirm({
      message: `¿Eliminar "${game.id}" con todas sus rutas?`,
      default: false,
    });
    if (!sure) return;

    const result = await deps.removeGameUseCase.execute({
      gameId: game.id,
    });
    printResult(game.id, result);
  } else {
    const sure = await confirm({
      message: `¿Eliminar la ruta de "${game.id}"?\n  → ${selectedPath}`,
      default: false,
    });
    if (!sure) return;

    const result = await deps.removeGameUseCase.execute({
      gameId: game.id,
      path: selectedPath,
    });
    printResult(game.id, result);
  }
}

function printResult(gameId: string, result: { removedGame: boolean; removedPath: boolean }): void {
  if (result.removedGame && result.removedPath) {
    console.log(`\n${figures.tick} Ruta eliminada. "${gameId}" ya no tenía rutas y fue eliminado.\n`);
  } else if (result.removedGame) {
    console.log(`\n${figures.tick} Juego "${gameId}" eliminado completamente.\n`);
  } else if (result.removedPath) {
    console.log(`\n${figures.tick} Ruta eliminada de "${gameId}".\n`);
  }
}

export async function runRemoveFromArgs(deps: CliDeps, args: string[]): Promise<void> {
  const gameId = args[1];
  if (!gameId) {
    console.error("Uso: SaveCloud remove <game-id> [ruta]");
    throw new Error("Arguments are missing");
  }
  const path = args[2];
  const result = await deps.removeGameUseCase.execute({ gameId, path });
  printResult(gameId, result);
}
