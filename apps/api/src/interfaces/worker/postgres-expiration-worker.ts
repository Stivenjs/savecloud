import { PurgeSoftDeletedMembersUseCase } from "@application/use-cases/PurgeSoftDeletedMembersUseCase";
import { PurgeExpiredNotificationsUseCase } from "@application/use-cases/PurgeExpiredNotificationsUseCase";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import { createS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { PostgresNotificationStore } from "@infrastructure/persistence/PostgresNotificationStore";
import { purgeExpiredPostgresRecords } from "@infrastructure/persistence/PostgresExpirationRepository";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";
import { readIntervalMs, runPeriodicTasks, startWorker, type PeriodicTask } from "./workerRuntime";

const DEFAULT_EXPIRATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MEMBER_PURGE_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

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
    const expirationIntervalMs = readIntervalMs("POSTGRES_EXPIRATION_INTERVAL_MS", DEFAULT_EXPIRATION_INTERVAL_MS, {
      minimum: 60_000,
      integer: true,
    });
    const memberPurgeIntervalMs = readIntervalMs("MEMBER_PURGE_INTERVAL_MS", DEFAULT_MEMBER_PURGE_INTERVAL_MS, {
      minimum: 10_000,
      integer: true,
    });

    const tasks: PeriodicTask[] = [
      {
        name: "postgres-expiration",
        intervalMs: expirationIntervalMs,
        execute: () => purgeExpiredRecords(sql),
      },
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
    ];

    await runPeriodicTasks(tasks, signal, INITIAL_DELAY_MS, (task) => {
      console.info(
        JSON.stringify({
          msg: `${task.name}.worker-start`,
          intervalMs: task.intervalMs,
          initialDelayMs: INITIAL_DELAY_MS,
        })
      );
    });
  } finally {
    s3.destroy();
    await sql.close();
  }
}

startWorker("postgres-expiration-worker", runWorker);
