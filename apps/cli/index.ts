#!/usr/bin/env bun
/**
 * Punto de entrada del CLI.
 * Sin argumentos + TTY → menú interactivo. Con comando → modo script.
 */
import { getCliArgs } from "./argv";
import { createContainer } from "./container";
import { runCommandMode, showHelp } from "./command-mode";
import { runInteractiveLoop } from "./menu";
import { waitForKeypressOnWindowsIfNeeded, isExitPromptError } from "./utils";
import figures from "figures";

process.on("uncaughtException", async (err) => {
  console.error(`\n${figures.cross} Error fatal:`, err.message);
  await waitForKeypressOnWindowsIfNeeded();
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`\n${figures.cross} Error no manejado:`, msg);
  await waitForKeypressOnWindowsIfNeeded();
  process.exit(1);
});

const args = getCliArgs();
const command = args[0];
const isInteractive = !command && process.stdin.isTTY;

async function main(): Promise<void> {
  const deps = createContainer();

  try {
    if (isInteractive) {
      await runInteractiveLoop(deps);
    } else if (!command) {
      showHelp();
    } else {
      const code = await runCommandMode(deps, command, args);
      await waitForKeypressOnWindowsIfNeeded();
      process.exit(code);
    }
  } catch (err) {
    if (isExitPromptError(err)) {
      console.log("");
      await waitForKeypressOnWindowsIfNeeded();
      process.exit(0);
    }
    console.error(`\n${figures.cross} Error:`, err instanceof Error ? err.message : String(err));
  }

  await waitForKeypressOnWindowsIfNeeded();
}

main();
