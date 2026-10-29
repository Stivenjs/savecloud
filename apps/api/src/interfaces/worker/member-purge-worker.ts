import { handler as runPurgeTick } from "@interfaces/lambda/member-purge/handler";

// Por defecto cada 1 hora en worker continuo
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

function readIntervalMs(): number {
  const configured = Number(process.env.MEMBER_PURGE_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : DEFAULT_INTERVAL_MS;
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
  console.info(
    JSON.stringify({
      msg: "member-purge.worker-start",
      intervalMs,
      initialDelayMs: INITIAL_DELAY_MS,
    })
  );

  await waitFor(INITIAL_DELAY_MS, signal);

  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      await runPurgeTick();
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: "member-purge.worker-tick-error",
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
      );
    }

    console.info(
      JSON.stringify({
        msg: "member-purge.worker-tick-finished",
        durationMs: Date.now() - startedAt,
      })
    );
    await waitFor(intervalMs, signal);
  }

  console.info("Member Purge worker detenido limpiamente.");
}

const shutdownController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  console.info(`Señal ${signal} recibida; deteniendo Member Purge worker.`);
  shutdownController.abort();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

runWorker(shutdownController.signal).catch((error) => {
  console.error("Fallo fatal del Member Purge worker:", error);
  process.exit(1);
});
