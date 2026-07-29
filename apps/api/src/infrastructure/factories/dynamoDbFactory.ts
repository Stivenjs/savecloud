import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";
import { resolveAwsCredentials } from "./awsCredentials";

/** Región por defecto para la infraestructura de AWS */
const DEFAULT_AWS_REGION = "us-east-2";

/** Número máximo de reintentos para peticiones al cliente de DynamoDB */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Tiempo máximo de espera (en ms) para la verificación de tablas al arrancar el servidor */
const TABLE_INIT_TIMEOUT_MS = 15000;

/** Estructura con las configuraciones opcionales de tablas de DynamoDB */
export interface DynamoDbTablesConfig {
  gameStatsTable?: string;
  saveFilesIndexTable?: string;
  connectionsTable?: string;
}

/**
 * Crea e inicializa una instancia de `DynamoDBClient` para comunicarse con AWS DynamoDB o DynamoDB Local.
 *
 * Configura la región, el endpoint personalizado (si existe `DYNAMODB_ENDPOINT`) y el límite de reintentos
 * (`maxAttempts: 3`) para evitar bloqueos indefinidos durante los arranques del servidor.
 *
 * @returns Instancia configurada del cliente de AWS DynamoDB.
 */
export function createDynamoDbClient(): DynamoDBClient {
  const awsRegion = process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION;
  const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined;

  return new DynamoDBClient({
    region: awsRegion,
    endpoint: dynamoEndpoint,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    credentials: resolveAwsCredentials(dynamoEndpoint ? "local" : undefined),
  });
}

/**
 * Verifica la existencia de las tablas de DynamoDB necesarias y las crea automáticamente en entornos locales o Docker.
 *
 * Incluye un tiempo máximo de espera de 15 segundos (`TABLE_INIT_TIMEOUT_MS`) para asegurar que la inicialización
 * del servidor espere a que DynamoDB Local levante.
 *
 * @param client - Instancia de `DynamoDBClient` para realizar las operaciones.
 * @param tables - Nombres de las tablas configuradas (`gameStatsTable`, `saveFilesIndexTable`, `connectionsTable`).
 * @returns Promesa que se resuelve cuando todas las tablas han sido verificadas o creadas.
 */
export async function ensureDynamoDbTablesExist(client: DynamoDBClient, tables: DynamoDbTablesConfig): Promise<void> {
  const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT?.trim();
  // Solo inicializar automáticamente si estamos en entorno local/docker
  if (!dynamoEndpoint) return;

  const initTables = async (): Promise<void> => {
    const { gameStatsTable, saveFilesIndexTable, connectionsTable } = tables;

    if (gameStatsTable) {
      await createTableIfNotExists(client, {
        TableName: gameStatsTable,
        AttributeDefinitions: [
          { AttributeName: "userId", AttributeType: "S" },
          { AttributeName: "gameId", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "gameId", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      });
    }

    if (saveFilesIndexTable) {
      await createTableIfNotExists(client, {
        TableName: saveFilesIndexTable,
        AttributeDefinitions: [
          { AttributeName: "userId", AttributeType: "S" },
          { AttributeName: "objectKey", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "objectKey", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      });
    }

    if (connectionsTable) {
      await createTableIfNotExists(client, {
        TableName: connectionsTable,
        AttributeDefinitions: [
          { AttributeName: "connectionId", AttributeType: "S" },
          { AttributeName: "userId", AttributeType: "S" },
        ],
        KeySchema: [{ AttributeName: "connectionId", KeyType: "HASH" }],
        GlobalSecondaryIndexes: [
          {
            IndexName: "UserIdIndex",
            KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          },
        ],
        BillingMode: "PAY_PER_REQUEST",
      });
    }
  };

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`DynamoDB table check timed out after ${TABLE_INIT_TIMEOUT_MS / 1000}s`)),
      TABLE_INIT_TIMEOUT_MS
    )
  );

  await Promise.race([initTables(), timeoutPromise]);
}

/**
 * Comprueba si una tabla existe en DynamoDB y la crea si falta.
 *
 * Incluye reintentos automáticos si la conexión es rechazada (ECONNREFUSED) mientras DynamoDB Local termina de arrancar.
 *
 * @param client - Instancia de `DynamoDBClient`.
 * @param tableInput - Definición del comando `CreateTableCommandInput` a ejecutar.
 * @param maxRetries - Número máximo de reintentos de conexión (por defecto 5).
 * @param delayMs - Tiempo de espera entre reintentos en ms (por defecto 1000 ms).
 */
async function createTableIfNotExists(
  client: DynamoDBClient,
  tableInput: CreateTableCommandInput,
  maxRetries = 5,
  delayMs = 1000
): Promise<void> {
  const tableName = tableInput.TableName;
  if (!tableName) return;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      return;
    } catch (err: unknown) {
      const errorObj = err as { name?: string; __type?: string; message?: string; code?: string } | undefined;
      const isConnRefused =
        errorObj?.code === "ECONNREFUSED" ||
        errorObj?.message?.includes("ECONNREFUSED") ||
        errorObj?.name === "TimeoutError";

      if (isConnRefused && attempt < maxRetries) {
        console.log(`[DynamoDB Local] Esperando a que DynamoDB esté disponible (intento ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      const isNotFound =
        err instanceof ResourceNotFoundException ||
        errorObj?.name === "ResourceNotFoundException" ||
        errorObj?.__type?.includes("ResourceNotFoundException") ||
        errorObj?.message?.includes("not found") ||
        errorObj?.message?.includes("non-existent");

      if (isNotFound) {
        try {
          await client.send(new CreateTableCommand(tableInput));
          console.log(`[DynamoDB Local] Tabla '${tableName}' creada exitosamente.`);
          return;
        } catch (createErr: unknown) {
          const createErrObj = createErr as { name?: string } | undefined;
          if (createErrObj?.name !== "ResourceInUseException") {
            console.warn(`[DynamoDB Local] Advertencia al crear tabla '${tableName}':`, createErr);
          }
          return;
        }
      } else {
        console.error(`[DynamoDB Local] Error al verificar tabla '${tableName}':`, err);
        return;
      }
    }
  }
}
