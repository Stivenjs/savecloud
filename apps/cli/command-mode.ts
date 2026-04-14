import type { CliDeps } from "@cli/container";
import * as commands from "@cli/commands";

export function showHelp(): void {
  console.log(`
SaveCloud — Sube y restaura guardados de juegos en la nube

Uso:
  SaveCloud                   Menú interactivo
  SaveCloud <comando> [args]    Modo comando

Comandos:
  add <game-id> <ruta>    Añade un juego
  remove <game-id> [ruta] Elimina un juego o una ruta
  list                    Lista juegos configurados
  scan                    Analiza rutas candidatas
  scan-paths              Gestiona rutas de escaneo personalizadas
  upload [game-id]        Sube guardados (pide juego si no se indica)
  download [game-id]      Descarga guardados
  config                  Muestra ruta del config

Ejemplos:
  SaveCloud add elden-ring "%APPDATA%/EldenRing"
  SaveCloud upload
`);
}

/**
 * Ejecuta el comando y devuelve el código de salida (0 = ok, 1 = error).
 * No llama a process.exit para que el índice pueda esperar Enter en Windows.
 */
export async function runCommandMode(deps: CliDeps, command: string, args: string[]): Promise<number> {
  if (command === "--help" || command === "-h") {
    showHelp();
    return 0;
  }

  try {
    switch (command) {
      case "add":
        await commands.runAddFromArgs(deps, args);
        return 0;
      case "remove":
        await commands.runRemoveFromArgs(deps, args);
        return 0;
      case "list":
        await commands.runList(deps);
        return 0;
      case "config":
        commands.runConfig(deps);
        return 0;
      case "scan":
        await commands.runScan(deps);
        return 0;
      case "scan-paths":
        await commands.runScanPathsInteractive(deps);
        return 0;
      case "upload":
        await commands.runUploadFromArgs(deps, args);
        return 0;
      case "download":
        await commands.runDownloadFromArgs(deps, args);
        return 0;
      default:
        console.error(`Comando desconocido: ${command}`);
        return 1;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message !== "Argumentos insuficientes" &&
      err.message !== "No se seleccionó juego"
    ) {
      console.error(err.message);
    }
    return 1;
  }
}
