import { PurgeSoftDeletedMembersUseCase } from "@application/use-cases/PurgeSoftDeletedMembersUseCase";
import { PurgeExpiredNotificationsUseCase } from "@application/use-cases/PurgeExpiredNotificationsUseCase";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import { createS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { PostgresNotificationStore } from "@infrastructure/persistence/PostgresNotificationStore";
import { purgeExpiredPostgresRecords } from "@infrastructure/persistence/PostgresExpirationRepository";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";

const DEFAULT_EXPIRATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MEMBER_PURGE_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

interface PeriodicTask {
  name: string;
  intervalMs: number;
  execute: () => Promise<void>;
}

/** Lee una variable de intervalo y aplica sus límites configurados. */
function readIntervalMs(name: string, defaultValue: number, minimum: number): number {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured >= minimum ? configured : defaultValue;
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

/** Ejecuta una tarea periódica con intervalo y manejo de errores independientes. */
async function runPeriodicTask(task: PeriodicTask, signal: AbortSignal): Promise<void> {
  console.info(
    JSON.stringify({ msg: `${task.name}.worker-start`, intervalMs: task.intervalMs, initialDelayMs: INITIAL_DELAY_MS })
  );
  await waitFor(INITIAL_DELAY_MS, signal);

  while (!signal.aborted) {
    const startedAt = Date.now();
    try {
      await task.execute();
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: `${task.name}.worker-tick-error`,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
    console.info(JSON.stringify({ msg: `${task.name}.worker-tick-finished`, durationMs: Date.now() - startedAt }));
    await waitFor(task.intervalMs, signal);
  }
}

/** Ejecuta las purgas de notificaciones y otros registros vencidos en PostgreSQL. */
async function purgeExpiredRecords(sql: ReturnType<typeof createDatabaseClient>): Promise<void> {
  const notificationStore = new PostgresNotificationStore(sql);
  const deletedNotifications = await new PurgeExpiredNotificationsUseCase(notificationStore).execute();
  const deletedRecords = await purgeExpiredPostgresRecords(sql, Math.floor(Date.now() / 1000));

  if (deletedNotifications > 0) {
    console.info(JSON.stringify({ msg: "postgres-expiration.notifications-purged", deleted: deletedNotifications }));
  }
  if (Object.values(deletedRecords).some((count) => count > 0)) {
    console.info(JSON.stringify({ msg: "postgres-expiration.records-purged", ...deletedRecords }));
  }
}

/** Inicializa PostgreSQL y S3 y programa las tareas periódicas de mantenimiento. */
async function runWorker(signal: AbortSignal): Promise<void> {
  const configuration = readDatabaseConfiguration();
  if (!configuration) throw new Error("[postgres-expiration-worker] Falta la configuración DATABASE_*.");

  const sql = createDatabaseClient(configuration);
  const s3 = createS3Client();

  try {
    const stores = createApiStores({ s3, database: sql, bucketName: getBucketName(), tables: {} });
    const notificationStore = new PostgresNotificationStore(sql);
    await notificationStore.ensureSchema();

    const memberPurge = new PurgeSoftDeletedMembersUseCase(stores.cloudInviteRepository, stores.saveRepository);
    const expirationIntervalMs = readIntervalMs(
      "POSTGRES_EXPIRATION_INTERVAL_MS",
      DEFAULT_EXPIRATION_INTERVAL_MS,
      60_000
    );
    const memberPurgeIntervalMs = readIntervalMs("MEMBER_PURGE_INTERVAL_MS", DEFAULT_MEMBER_PURGE_INTERVAL_MS, 10_000);

    await Promise.all([
      runPeriodicTask(
        {
          name: "postgres-expiration",
          intervalMs: expirationIntervalMs,
          execute: () => purgeExpiredRecords(sql),
        },
        signal
      ),
      runPeriodicTask(
        {
          name: "member-purge",
          intervalMs: memberPurgeIntervalMs,
          execute: async () => {
            const result = await memberPurge.execute();
            console.info(
              JSON.stringify({
                msg: "member-purge.cycle-completed",
                purged: result.purged,
                errorsCount: result.errors.length,
              })
            );
          },
        },
        signal
      ),
    ]);
  } finally {
    s3.destroy();
    await sql.close();
  }
}

const shutdownController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  console.info(`[postgres-expiration-worker] Señal ${signal} recibida; deteniendo el worker.`);
  shutdownController.abort();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

runWorker(shutdownController.signal).catch((error: unknown) => {
  console.error("[postgres-expiration-worker] Error fatal:", error);
  process.exitCode = 1;
});
