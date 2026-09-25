import { select } from "@inquirer/prompts";
import figures from "figures";
import type { CliDeps } from "@cli/container";
import { listAllFilesFromPaths } from "@cli/infrastructure/listSaveFiles";

export async function selectGame(deps: CliDeps, message: string): Promise<string | null> {
  const games = await deps.listGamesUseCase.execute();
  if (games.length === 0) {
    console.log("No hay juegos configurados. Añade uno primero.");
    return null;
  }
  const choice = await select({
    message,
    choices: games.map((g) => ({
      name: `${g.id} (${g.paths.length} ruta(s))`,
      value: g.id,
    })),
  });
  return choice;
}

async function uploadFileToS3(
  apiBaseUrl: string,
  userId: string,
  apiKey: string,
  gameId: string,
  filePath: string,
  filename: string
): Promise<void> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/saves/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ gameId, filename }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API upload-url: ${res.status} ${text}`);
  }
  const { uploadUrl } = (await res.json()) as {
    uploadUrl: string;
    key: string;
  };
  const file = Bun.file(filePath);
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!putRes.ok) {
    throw new Error(`S3 PUT: ${putRes.status} ${await putRes.text()}`);
  }
}

export async function runUploadInteractive(deps: CliDeps): Promise<void> {
  const gameId = await selectGame(deps, "Elige el juego del que subir guardados");
  if (!gameId) return;
  await doUpload(deps, gameId);
}

export async function runUploadFromArgs(deps: CliDeps, args: string[]): Promise<void> {
  let gameId: string | null = args[1] ?? null;
  if (!gameId) {
    gameId = await selectGame(deps, "Elige el juego del que subir guardados");
    if (!gameId) {
      console.error("No se seleccionó ningún juego.");
      throw new Error("No game selected");
    }
  }
  await doUpload(deps, gameId);
}

async function doUpload(deps: CliDeps, gameId: string): Promise<void> {
  const config = await deps.getConfigUseCase.execute();
  if (!config.apiBaseUrl?.trim() || !config.userId?.trim()) {
    console.error("Configura apiBaseUrl y userId en el config. Usa el comando «config» para ver la ruta del archivo.");
    throw new Error("Missing apiBaseUrl or userId in config");
  }

  const game = config.games.find((g) => g.id.toLowerCase() === gameId.toLowerCase());
  if (!game) {
    console.error(`Juego no encontrado: ${gameId}`);
    throw new Error("Game not found");
  }

  const files = listAllFilesFromPaths([...game.paths]);
  if (files.length === 0) {
    console.log(`No se encontraron archivos de guardado en las rutas de ${gameId}.`);
    return;
  }

  console.log(`\n${figures.arrowUp} Subiendo ${files.length} archivo(s) de: ${gameId}\n`);
  let ok = 0;
  let err = 0;
  for (const { absolute, relative } of files) {
    try {
      await uploadFileToS3(config.apiBaseUrl!, config.userId!, config.apiKey ?? "", gameId, absolute, relative);
      console.log(` ${figures.tick}`, relative);
      ok++;
    } catch (e) {
      console.error(` ${figures.cross}`, relative, "-", e instanceof Error ? e.message : e);
      err++;
    }
  }
  console.log(`\nListo: ${ok} subido(s), ${err} error(es).\n`);
}
