import { PurgeExpiredNotificationsUseCase } from "@application/use-cases/PurgeExpiredNotificationsUseCase";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import { PostgresNotificationStore } from "@infrastructure/persistence/PostgresNotificationStore";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

/** Lee el intervalo de mantenimiento y aplica el mínimo aceptado de un minuto. */
function readIntervalMs(): number {
  const configured = Number(process.env.NOTIFICATIONS_EXPIRATION_INTERVAL_MS);
  return Number.isSafeInteger(configured) && configured >= 60_000 ? configured : DEFAULT_INTERVAL_MS;
}

/** Espera el intervalo indicado y permite que SIGINT/SIGTERM detengan el worker. */
function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Inicializa el repositorio y elimina periódicamente los inboxes ya vencidos. */
async function runWorker(signal: AbortSignal): Promise<void> {
  const configuration = readDatabaseConfiguration();
  if (!configuration) throw new Error("[notification-expiration-worker] Falta la configuración DATABASE_*.");
  const sql = createDatabaseClient(configuration);

  try {
    const repository = new PostgresNotificationStore(sql);
    await repository.ensureSchema();
    const useCase = new PurgeExpiredNotificationsUseCase(repository);
    const intervalMs = readIntervalMs();

    console.info(
      JSON.stringify({ msg: "notifications-expiration.worker-start", intervalMs, initialDelayMs: INITIAL_DELAY_MS })
    );
    await waitFor(INITIAL_DELAY_MS, signal);

    while (!signal.aborted) {
      const startedAt = Date.now();
      try {
        const deleted = await useCase.execute();
        if (deleted > 0) {
          console.info(JSON.stringify({ msg: "notifications-expiration.purged", deleted }));
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            msg: "notifications-expiration.worker-tick-error",
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
      console.info(
        JSON.stringify({ msg: "notifications-expiration.worker-tick-finished", durationMs: Date.now() - startedAt })
      );
      await waitFor(intervalMs, signal);
    }
  } finally {
    await sql.close();
  }
}

const shutdownController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  console.info(`[notification-expiration-worker] Señal ${signal} recibida; deteniendo el worker.`);
  shutdownController.abort();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

runWorker(shutdownController.signal).catch((error: unknown) => {
  console.error("[notification-expiration-worker] Error fatal:", error);
  process.exitCode = 1;
});
