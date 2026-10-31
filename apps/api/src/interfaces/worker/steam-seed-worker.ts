import { handler as runSteamSeedTick } from "@interfaces/lambda/steam-seed/handler";

const DEFAULT_DETAILS_INTERVAL_MS = 30 * 1000;
const DEFAULT_REVIEWS_INTERVAL_MS = 2 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

function readIntervalMs(name: string, fallback: number): number {
  const configured = Number(process.env[name] ?? process.env.SEED_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 1_000 ? configured : fallback;
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

async function runTask(task: "details" | "reviews", intervalMs: number, signal: AbortSignal): Promise<void> {
  console.info(
    JSON.stringify({ msg: "steam-seed.worker-task-start", task, intervalMs, initialDelayMs: INITIAL_DELAY_MS })
  );
  await waitFor(INITIAL_DELAY_MS, signal);
  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      await runSteamSeedTick({ task });
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: "steam-seed.worker-task-error",
          task,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
      );
    }

    console.info(JSON.stringify({ msg: "steam-seed.worker-task-finished", task, durationMs: Date.now() - startedAt }));
    await waitFor(intervalMs, signal);
  }
}

async function runWorker(signal: AbortSignal): Promise<void> {
  const detailsIntervalMs = readIntervalMs("SEED_DETAILS_INTERVAL_MS", DEFAULT_DETAILS_INTERVAL_MS);
  const reviewsIntervalMs = readIntervalMs("SEED_REVIEWS_INTERVAL_MS", DEFAULT_REVIEWS_INTERVAL_MS);
  console.info(JSON.stringify({ msg: "steam-seed.worker-start", detailsIntervalMs, reviewsIntervalMs }));
  await Promise.all([runTask("details", detailsIntervalMs, signal), runTask("reviews", reviewsIntervalMs, signal)]);
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
