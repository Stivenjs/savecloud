import { select, confirm } from "@inquirer/prompts";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import figures from "figures";
import type { CliDeps } from "@cli/container";
import { expandPath } from "@cli/infrastructure/listSaveFiles";
import { formatSize } from "@cli/utils";

interface RemoteSave {
  gameId: string;
  key: string;
  filename: string;
  lastModified: Date;
  size?: number;
}

async function fetchRemoteSaves(apiBaseUrl: string, userId: string, apiKey: string): Promise<RemoteSave[]> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/saves`, {
    headers: { "x-user-id": userId, "x-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`API /saves: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as Array<{
    gameId: string;
    key: string;
    lastModified: string;
    size?: number;
  }>;
  return raw.map((s) => {
    const parts = s.key.split("/");
    const filename = parts.slice(2).join("/");
    return {
      gameId: s.gameId,
      key: s.key,
      filename,
      lastModified: new Date(s.lastModified),
      size: s.size,
    };
  });
}

async function fetchDownloadUrl(
  apiBaseUrl: string,
  userId: string,
  apiKey: string,
  gameId: string,
  key: string
): Promise<string> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/saves/download-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ gameId, key }),
  });
  if (!res.ok) {
    throw new Error(`API download-url: ${res.status} ${await res.text()}`);
  }
  const { downloadUrl } = (await res.json()) as { downloadUrl: string };
  return downloadUrl;
}

async function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`S3 GET: ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const dir = dirname(destPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(destPath, Buffer.from(buffer));
}

export async function runDownloadInteractive(deps: CliDeps): Promise<void> {
  const config = await deps.getConfigUseCase.execute();
  if (!config.apiBaseUrl?.trim() || !config.userId?.trim()) {
    console.error("Configura apiBaseUrl y userId en el config. Usa el comando «config» para ver la ruta del archivo.");
    return;
  }

  console.log(`\n${figures.arrowDown} Consultando guardados en la nube...\n`);
  const allSaves = await fetchRemoteSaves(config.apiBaseUrl!, config.userId!, config.apiKey ?? "");

  if (allSaves.length === 0) {
    console.log("No hay guardados en la nube.\n");
    return;
  }

  const byGame = new Map<string, RemoteSave[]>();
  for (const s of allSaves) {
    const list = byGame.get(s.gameId) ?? [];
    list.push(s);
    byGame.set(s.gameId, list);
  }

  const gameChoices = [...byGame.entries()].map(([gameId, saves]) => {
    const totalSize = saves.reduce((sum, s) => sum + (s.size ?? 0), 0);
    return {
      name: `${gameId}  (${saves.length} archivo${saves.length > 1 ? "s" : ""}, ${formatSize(totalSize)})`,
      value: gameId,
    };
  });

  const CANCEL = "__cancel__";
  const selectedGameId = await select<string>({
    message: "¿De qué juego quieres restaurar los guardados?",
    choices: [...gameChoices, { name: `${figures.arrowLeft} Cancelar`, value: CANCEL }],
  });

  if (selectedGameId === CANCEL) return;

  const saves = byGame.get(selectedGameId)!;
  const game = config.games.find((g) => g.id.toLowerCase() === selectedGameId.toLowerCase());

  if (!game) {
    console.error(`\nEl juego "${selectedGameId}" no está configurado localmente.`);
    console.error("Añádelo primero con «Añadir un juego» para definir sus rutas.\n");
    return;
  }

  const destBase = resolve(expandPath(game.paths[0]));

  console.log(`\n${figures.squareSmallFilled} ${saves.length} archivo(s) de "${selectedGameId}" en la nube:`);
  for (const s of saves) {
    const sizeStr = s.size ? ` (${formatSize(s.size)})` : "";
    console.log(`  • ${s.filename}${sizeStr}`);
  }
  console.log(`\n${figures.arrowRight} Destino: ${destBase}\n`);

  const sure = await confirm({
    message: `¿Descargar y restaurar ${saves.length} archivo(s)?`,
    default: true,
  });
  if (!sure) return;

  await doDownload(config.apiBaseUrl!, config.userId!, config.apiKey ?? "", selectedGameId, saves, destBase);
}

export async function runDownloadFromArgs(deps: CliDeps, args: string[]): Promise<void> {
  const config = await deps.getConfigUseCase.execute();
  if (!config.apiBaseUrl?.trim() || !config.userId?.trim()) {
    console.error("Configura apiBaseUrl y userId en el config.");
    throw new Error("Missing apiBaseUrl or userId in config");
  }

  let gameId: string | null = args[1] ?? null;
  if (!gameId) {
    const games = await deps.listGamesUseCase.execute();
    if (games.length === 0) {
      console.log("No hay juegos configurados.");
      return;
    }
    gameId = await select({
      message: "Elige el juego del que descargar guardados",
      choices: games.map((g) => ({ name: g.id, value: g.id })),
    });
  }

  const game = config.games.find((g) => g.id.toLowerCase() === gameId!.toLowerCase());
  if (!game) {
    console.error(`Juego no configurado: ${gameId}`);
    throw new Error("Game not found");
  }

  console.log(`\n${figures.arrowDown} Consultando guardados en la nube...\n`);
  const allSaves = await fetchRemoteSaves(config.apiBaseUrl!, config.userId!, config.apiKey ?? "");
  const saves = allSaves.filter((s) => s.gameId.toLowerCase() === gameId!.toLowerCase());

  if (saves.length === 0) {
    console.log(`No hay guardados de "${gameId}" en la nube.\n`);
    return;
  }

  const destBase = resolve(expandPath(game.paths[0]));
  await doDownload(config.apiBaseUrl!, config.userId!, config.apiKey ?? "", gameId!, saves, destBase);
}

async function doDownload(
  apiBaseUrl: string,
  userId: string,
  apiKey: string,
  gameId: string,
  saves: RemoteSave[],
  destBase: string
): Promise<void> {
  console.log(`\n${figures.arrowDown} Descargando ${saves.length} archivo(s) de: ${gameId}\n`);

  let ok = 0;
  let err = 0;

  for (const save of saves) {
    const destPath = join(destBase, save.filename);
    try {
      const url = await fetchDownloadUrl(apiBaseUrl, userId, apiKey, gameId, save.key);
      await downloadFileFromUrl(url, destPath);
      console.log(` ${figures.tick}`, save.filename);
      ok++;
    } catch (e) {
      console.error(` ${figures.cross}`, save.filename, "-", e instanceof Error ? e.message : e);
      err++;
    }
  }

  console.log(`\nListo: ${ok} descargado(s), ${err} error(es).`);
  console.log(`${figures.arrowRight} Restaurados en: ${destBase}\n`);
}
