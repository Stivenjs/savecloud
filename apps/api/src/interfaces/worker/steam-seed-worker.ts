import { handler as runSteamSeedTick } from "@interfaces/lambda/steam-seed/handler";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

function readIntervalMs(): number {
  const configured = Number(process.env.SEED_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_INTERVAL_MS;
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function runWorker(signal: AbortSignal): Promise<void> {
  const intervalMs = readIntervalMs();
  console.info(JSON.stringify({ msg: "steam-seed.worker-start", intervalMs, initialDelayMs: INITIAL_DELAY_MS }));

  await waitFor(INITIAL_DELAY_MS, signal);
  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      await runSteamSeedTick({});
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: "steam-seed.worker-tick-error",
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
      );
    }

    console.info(JSON.stringify({ msg: "steam-seed.worker-tick-finished", durationMs: Date.now() - startedAt }));
    await waitFor(intervalMs, signal);
  }

  console.info("Steam Seed worker detenido.");
}

const shutdownController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  console.info(`Señal ${signal} recibida; deteniendo Steam Seed worker.`);
  shutdownController.abort();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

runWorker(shutdownController.signal).catch((error: unknown) => {
  console.error("Fallo fatal del Steam Seed worker:", error);
  process.exitCode = 1;
});
