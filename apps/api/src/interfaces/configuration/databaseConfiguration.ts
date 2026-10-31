import type { DatabaseConnectionOptions } from "@infrastructure/database/DatabaseConnectionOptions";

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_POSTGRES_PORT = 5432;

/** Lee y valida la configuración PostgreSQL estándar compartida por los servicios de la API. */
export function readDatabaseConfiguration(env: NodeJS.ProcessEnv = process.env): DatabaseConnectionOptions | undefined {
  const connectionString = env.DATABASE_URL?.trim();
  const poolSize = readPositiveInteger(env.DATABASE_POOL_SIZE, DEFAULT_POOL_SIZE, "DATABASE_POOL_SIZE");

  if (connectionString) {
    validateConnectionString(connectionString);
    return { connectionString, poolSize };
  }

  const hostname = env.DATABASE_HOST?.trim();
  const username = env.DATABASE_USER?.trim();
  const password = env.DATABASE_PASSWORD;
  const database = env.DATABASE_NAME?.trim();
  if (!hostname && !username && !password && !database) return undefined;
  if (!hostname || !username || !password || !database) {
    throw new Error(
      "[bootstrap] Configuración PostgreSQL incompleta: define DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD y DATABASE_NAME."
    );
  }

  return {
    hostname,
    port: readPositiveInteger(env.DATABASE_PORT, DEFAULT_POSTGRES_PORT, "DATABASE_PORT"),
    username,
    password,
    database,
    poolSize,
  };
}

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`[bootstrap] ${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function validateConnectionString(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error();
  } catch {
    throw new Error("[bootstrap] DATABASE_URL debe usar el protocolo postgres:// o postgresql://.");
  }
}
