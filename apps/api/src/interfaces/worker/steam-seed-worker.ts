import { handler as runSteamSeedTick } from "@interfaces/lambda/steam-seed/handler";
import { readIntervalMs, runPeriodicTasks, startWorker, type PeriodicTask } from "./workerRuntime";

const DEFAULT_DETAILS_INTERVAL_MS = 30 * 1000;
const DEFAULT_REVIEWS_INTERVAL_MS = 2 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

/** Crea una tarea Steam Seed con el registro de error específico de esta integración. */
function createSteamSeedTask(task: "details" | "reviews", intervalMs: number): PeriodicTask {
  return {
    name: `steam-seed.${task}`,
    intervalMs,
    execute: async () => {
      await runSteamSeedTick({ task });
    },
    onError: (error) =>
      console.error(
        JSON.stringify({
          msg: "steam-seed.worker-task-error",
          task,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
      ),
  };
}

/** Ejecuta las tareas programadas de datos y reseñas de Steam. */
async function runWorker(signal: AbortSignal): Promise<void> {
  const detailsIntervalMs = readIntervalMs("SEED_DETAILS_INTERVAL_MS", DEFAULT_DETAILS_INTERVAL_MS, {
    minimum: 1_000,
    fallbackName: "SEED_INTERVAL_MS",
  });
  const reviewsIntervalMs = readIntervalMs("SEED_REVIEWS_INTERVAL_MS", DEFAULT_REVIEWS_INTERVAL_MS, {
    minimum: 1_000,
    fallbackName: "SEED_INTERVAL_MS",
  });
  const tasks = [createSteamSeedTask("details", detailsIntervalMs), createSteamSeedTask("reviews", reviewsIntervalMs)];

  console.info(JSON.stringify({ msg: "steam-seed.worker-start", detailsIntervalMs, reviewsIntervalMs }));
  await runPeriodicTasks(tasks, signal, INITIAL_DELAY_MS, (task) => {
    console.info(
      JSON.stringify({
        msg: "steam-seed.worker-task-start",
        task: task.name.split(".").at(-1),
        intervalMs: task.intervalMs,
        initialDelayMs: INITIAL_DELAY_MS,
      })
    );
  });
  console.info("Steam Seed worker detenido.");
}

startWorker("steam-seed-worker", runWorker);
