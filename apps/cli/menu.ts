import { select, confirm, Separator } from "@inquirer/prompts";
import figures from "figures";
import type { MainAction } from "@cli/constants";
import type { CliDeps } from "@cli/container";
import { isExitPromptError } from "@cli/utils";
import * as commands from "@cli/commands";

async function showMainMenu(): Promise<MainAction> {
  return select<MainAction>({
    message: "¿Qué quieres hacer?",
    pageSize: 12,
    choices: [
      {
        name: `${figures.pointer} Añadir un juego (ruta de guardados)`,
        value: "add",
      },
      { name: `${figures.cross} Eliminar un juego o ruta`, value: "remove" },
      {
        name: `${figures.hamburger} Listar juegos configurados`,
        value: "list",
      },
      {
        name: `${figures.arrowRight} Analizar rutas (buscar candidatos)`,
        value: "scan",
      },
      new Separator(),
      { name: `${figures.arrowUp} Subir guardados a la nube`, value: "upload" },
      { name: `${figures.arrowDown} Descargar guardados`, value: "download" },
      new Separator(),
      {
        name: `${figures.lozenge} Rutas de escaneo personalizadas`,
        value: "scan-paths",
      },
      {
        name: `${figures.bullet} Ver ruta del archivo de config`,
        value: "config",
      },
      new Separator(),
      { name: "Salir", value: "exit" },
    ],
  });
}

async function runAction(deps: CliDeps, action: MainAction): Promise<void> {
  switch (action) {
    case "add":
      await commands.runAddInteractive(deps);
      break;
    case "remove":
      await commands.runRemoveInteractive(deps);
      break;
    case "list":
      await commands.runList(deps);
      break;
    case "scan":
      await commands.runScan(deps);
      break;
    case "scan-paths":
      await commands.runScanPathsInteractive(deps);
      break;
    case "upload":
      await commands.runUploadInteractive(deps);
      break;
    case "download":
      await commands.runDownloadInteractive(deps);
      break;
    case "config":
      commands.runConfig(deps);
      break;
    case "exit":
      console.log("Hasta luego.\n");
      process.exit(0);
  }
}

async function askReturnToMenu(): Promise<boolean> {
  try {
    return await confirm({
      message: "¿Volver al menú?",
      default: true,
    });
  } catch (err) {
    if (isExitPromptError(err)) return false;
    return false;
  }
}

export async function runInteractiveLoop(deps: CliDeps): Promise<void> {
  try {
    const { printWelcomeBanner } = await import("@cli/banner");
    await printWelcomeBanner();
  } catch {
    console.log("\n  SaveCloud — Guardados en la nube\n");
  }

  while (true) {
    let action: MainAction;

    try {
      action = await showMainMenu();
    } catch (err) {
      if (isExitPromptError(err)) {
        console.log("\nHasta luego.\n");
        return;
      }
      console.error("\nError inesperado:", err instanceof Error ? err.message : err);
      return;
    }

    try {
      await runAction(deps, action);
    } catch (err) {
      if (isExitPromptError(err)) {
        console.log(`\n${figures.arrowLeft} Operación cancelada.\n`);
      } else {
        console.error(`\n${figures.cross} Error:`, err instanceof Error ? err.message : err, "\n");
      }
    }

    if (action !== "exit") {
      const again = await askReturnToMenu();
      if (!again) {
        console.log("Hasta luego.\n");
        return;
      }
    }
  }
}
