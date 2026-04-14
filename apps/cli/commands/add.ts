import { input, select, Separator } from "@inquirer/prompts";
import figures from "figures";
import type { CliDeps } from "@cli/container";
import type { PathCandidate } from "@cli/domain/entities/PathCandidate";
import { toGameId } from "@cli/utils";

const MANUAL_OPTION = "__manual__";

export async function runAddInteractive(deps: CliDeps): Promise<void> {
  console.log(`\n${figures.arrowRight} Buscando juegos en rutas conocidas...\n`);
  const candidates = await deps.scanForPathCandidatesUseCase.execute();

  let selectedPath: string;
  let suggestedId: string;

  if (candidates.length > 0) {
    const choices = buildCandidateChoices(candidates);

    const picked = await select<string>({
      message: "Selecciona un juego detectado o escribe manualmente",
      pageSize: 15,
      choices,
    });

    if (picked === MANUAL_OPTION) {
      ({ gameId: suggestedId, path: selectedPath } = await promptManual());
    } else {
      const candidate = candidates.find((c) => c.path === picked)!;
      selectedPath = candidate.path;
      suggestedId = await input({
        message: "Identificador del juego",
        default: toGameId(candidate.folderName),
        validate: (v) => (v.trim() ? true : "Escribe un nombre"),
      });
    }
  } else {
    console.log("No se encontraron juegos automáticamente.\n");
    ({ gameId: suggestedId, path: selectedPath } = await promptManual());
  }

  const gameId = suggestedId.trim();
  const path = selectedPath.trim();

  const editionLabel = await input({
    message: "Origen/edición del juego (opcional, ej. Steam, Empress, RUNE)",
    default: "",
  });
  const sourceUrl = await input({
    message: "URL de descarga o página de la edición (opcional)",
    default: "",
  });

  await deps.addGameUseCase.execute({
    gameId,
    path,
    editionLabel: editionLabel.trim() || undefined,
    sourceUrl: sourceUrl.trim() || undefined,
  });
  console.log(`\n${figures.tick} Añadido:`, gameId, figures.arrowRight, path);
}

function buildCandidateChoices(candidates: PathCandidate[]) {
  const choices: Array<{ name: string; value: string } | InstanceType<typeof Separator>> = [];
  let currentBase = "";

  for (const c of candidates) {
    if (c.basePath !== currentBase) {
      currentBase = c.basePath;
      choices.push(new Separator(`── ${currentBase} ──`));
    }
    choices.push({
      name: `${c.folderName}  →  ${c.path}`,
      value: c.path,
    });
  }

  choices.push(new Separator());
  choices.push({
    name: `${figures.pointer} Escribir manualmente`,
    value: MANUAL_OPTION,
  });
  return choices;
}

async function promptManual(): Promise<{ gameId: string; path: string }> {
  const gameId = await input({
    message: "Identificador del juego (ej. elden-ring)",
    validate: (v) => (v.trim() ? true : "Escribe un nombre"),
  });
  const path = await input({
    message: "Ruta de la carpeta o archivo de guardado",
    default: process.platform === "win32" ? "%APPDATA%" : "~",
    validate: (v) => (v.trim() ? true : "Escribe una ruta"),
  });
  return { gameId, path };
}

export async function runAddFromArgs(deps: CliDeps, args: string[]): Promise<void> {
  const gameId = args[1];
  const path = args[2];
  if (!gameId || !path) {
    console.error("Uso: SaveCloud add <game-id> <ruta> [origen/edición] [url-descarga]");
    throw new Error("Arguments are missing");
  }
  const editionLabel = args[3];
  const sourceUrl = args[4];
  await deps.addGameUseCase.execute({
    gameId,
    path,
    editionLabel,
    sourceUrl,
  });
  console.log("Añadido:", gameId, "→", path);
}
