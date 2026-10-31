import { SQL } from "bun";
import type { DatabaseConnectionOptions } from "@infrastructure/database/DatabaseConnectionOptions";

const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10;

/** Crea el pool PostgreSQL de la aplicación con la configuración ya validada. */
export function createDatabaseClient(configuration: DatabaseConnectionOptions): SQL {
  if (configuration.connectionString) {
    return new SQL(configuration.connectionString, {
      max: configuration.poolSize,
      connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_SECONDS,
    });
  }

  if (!configuration.hostname || !configuration.username || !configuration.password || !configuration.database) {
    throw new Error("[database] La configuración de conexión PostgreSQL está incompleta.");
  }

  return new SQL({
    adapter: "postgres",
    hostname: configuration.hostname,
    port: configuration.port ?? 5432,
    username: configuration.username,
    password: configuration.password,
    database: configuration.database,
    max: configuration.poolSize,
    connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_SECONDS,
  });
}
