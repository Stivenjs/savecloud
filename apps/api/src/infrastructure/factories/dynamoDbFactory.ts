import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";

/** Región por defecto para la infraestructura de AWS */
const DEFAULT_AWS_REGION = "us-east-2";

/** Número máximo de reintentos para peticiones al cliente de DynamoDB */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Tiempo máximo de espera (en ms) para la verificación de tablas al arrancar el servidor */
const TABLE_INIT_TIMEOUT_MS = 5000;

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

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() || (dynamoEndpoint ? "local" : undefined);
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || (dynamoEndpoint ? "local" : undefined);

  return new DynamoDBClient({
    region: awsRegion,
    endpoint: dynamoEndpoint,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
}

/**
 * Verifica la existencia de las tablas de DynamoDB necesarias y las crea automáticamente en entornos locales o Docker.
 *
 * Incluye un tiempo máximo de espera de 5 segundos (`TABLE_INIT_TIMEOUT_MS`) para asegurar que la inicialización
 * del servidor no se cuelgue si DynamoDB Local tarda en responder.
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
 * Tolera variaciones en los tipos de error de DynamoDB Local (`ResourceNotFoundException`, `__type` o mensajes).
 *
 * @param client - Instancia de `DynamoDBClient`.
 * @param tableInput - Definición del comando `CreateTableCommandInput` a ejecutar.
 */
async function createTableIfNotExists(client: DynamoDBClient, tableInput: CreateTableCommandInput): Promise<void> {
  const tableName = tableInput.TableName;
  if (!tableName) return;

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (err: unknown) {
    const errorObj = err as { name?: string; __type?: string; message?: string } | undefined;
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
      } catch (createErr: unknown) {
        const createErrObj = createErr as { name?: string } | undefined;
        if (createErrObj?.name !== "ResourceInUseException") {
          console.warn(`[DynamoDB Local] Advertencia al crear tabla '${tableName}':`, createErr);
        }
      }
    } else {
      console.error(`[DynamoDB Local] Error al verificar tabla '${tableName}':`, err);
    }
  }
}
