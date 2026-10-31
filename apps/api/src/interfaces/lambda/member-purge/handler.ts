import type { Context } from "aws-lambda";
import { createApiStores } from "@infrastructure/factories/apiStoresFactory";
import { createDynamoDbClient } from "@infrastructure/factories/dynamoDbFactory";
import { createDatabaseClient } from "@infrastructure/factories/databaseClientFactory";
import { readDatabaseConfiguration } from "@interfaces/configuration/databaseConfiguration";
import { createS3Client, getBucketName } from "@infrastructure/factories/storageFactory";
import { PurgeSoftDeletedMembersUseCase } from "@application/use-cases/PurgeSoftDeletedMembersUseCase";

let purgeUseCase: PurgeSoftDeletedMembersUseCase | null = null;

function getPurgeUseCase(): PurgeSoftDeletedMembersUseCase {
  if (purgeUseCase) return purgeUseCase;

  const bucketName = getBucketName();
  const cloudInvitesTable = process.env.CLOUD_INVITES_TABLE?.trim() || undefined;
  const databaseConfiguration = readDatabaseConfiguration();
  const database = databaseConfiguration ? createDatabaseClient(databaseConfiguration) : undefined;

  const s3 = createS3Client();
  const dynamoClient = database ? undefined : createDynamoDbClient();

  const stores = createApiStores({
    s3,
    dynamo: dynamoClient,
    database,
    bucketName,
    tables: {
      cloudInvites: cloudInvitesTable,
    },
  });

  purgeUseCase = new PurgeSoftDeletedMembersUseCase(stores.cloudInviteRepository, stores.saveRepository);
  return purgeUseCase;
}

/**
 * Entry point del worker Lambda para la purga de miembros eliminados (soft delete).
 *
 * Invocado periódicamente vía EventBridge / Cron (p.ej. diario o cada pocas horas).
 * Busca todas las membresías cuyo período de gracia ha expirado y elimina
 * definitivamente sus saves en S3 y registros de DynamoDB.
 */
export async function handler(_event?: unknown, _context?: Partial<Context>): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  console.info("[member-purge] Iniciando ciclo de purga de miembros soft-deleted...");

  try {
    const useCase = getPurgeUseCase();
    const result = await useCase.execute();
    const durationMs = Date.now() - startedAt;

    console.info(
      JSON.stringify({
        msg: "member-purge.cycle-completed",
        purged: result.purged,
        errorsCount: result.errors.length,
        durationMs,
      })
    );

    return {
      ok: true,
      purged: result.purged,
      errors: result.errors,
      durationMs,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[member-purge] Error fatal en ciclo de purga:", err);
    return {
      ok: false,
      error: errorMessage,
      durationMs: Date.now() - startedAt,
    };
  }
}
