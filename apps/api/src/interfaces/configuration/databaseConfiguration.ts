import type { DatabaseConnectionOptions } from "@infrastructure/database/DatabaseConnectionOptions";

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_POSTGRES_PORT = 5432;

const ALLOWED_POSTGRES_PROTOCOLS: readonly string[] = ["postgres:", "postgresql:"];

const ERROR_PREFIX = "[bootstrap]";

/**
 * Variables de entorno individuales que describen una conexión PostgreSQL
 * cuando no se provee `DATABASE_URL`.
 */
interface DiscreteConnectionSettings {
  readonly hostname: string | undefined;
  readonly username: string | undefined;
  readonly password: string | undefined;
  readonly database: string | undefined;
}

/**
 * Lee y valida la configuración PostgreSQL estándar compartida por los servicios de la API.
 *
 * Orden de prioridad:
 * 1. `DATABASE_URL`, si está definida (se ignoran las demás variables de conexión).
 * 2. Variables individuales: `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`,
 *    `DATABASE_NAME` y, opcionalmente, `DATABASE_PORT`.
 *
 * `DATABASE_POOL_SIZE` es opcional y se valida siempre, incluso si no hay configuración de base de datos.
 *
 * @param env - Variables de entorno a leer. Por defecto `process.env`.
 * @returns Las opciones de conexión, o `undefined` si no se definió ninguna variable de base de datos.
 * @throws {Error} Si `DATABASE_POOL_SIZE` o `DATABASE_PORT` no son enteros positivos,
 * si `DATABASE_URL` no usa un protocolo PostgreSQL, o si la configuración individual está incompleta.
 */
export function readDatabaseConfiguration(env: NodeJS.ProcessEnv = process.env): DatabaseConnectionOptions | undefined {
  const poolSize = readPositiveInteger(env.DATABASE_POOL_SIZE, DEFAULT_POOL_SIZE, "DATABASE_POOL_SIZE");

  const connectionString = env.DATABASE_URL?.trim();
  if (connectionString) {
    assertPostgresConnectionString(connectionString);
    return { connectionString, poolSize };
  }

  const settings = readDiscreteConnectionSettings(env);
  if (isEmpty(settings)) return undefined;
  assertComplete(settings);

  return {
    hostname: settings.hostname,
    port: readPositiveInteger(env.DATABASE_PORT, DEFAULT_POSTGRES_PORT, "DATABASE_PORT"),
    username: settings.username,
    password: settings.password,
    database: settings.database,
    poolSize,
  };
}

/**
 * Extrae las variables individuales de conexión. Todas se recortan (`trim`)
 * excepto la contraseña, donde los espacios pueden ser significativos.
 */
function readDiscreteConnectionSettings(env: NodeJS.ProcessEnv): DiscreteConnectionSettings {
  return {
    hostname: env.DATABASE_HOST?.trim(),
    username: env.DATABASE_USER?.trim(),
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME?.trim(),
  };
}

/** Indica si ninguna de las variables individuales de conexión fue definida. */
function isEmpty(settings: DiscreteConnectionSettings): boolean {
  return !settings.hostname && !settings.username && !settings.password && !settings.database;
}

/**
 * Verifica que todas las variables individuales de conexión estén presentes.
 *
 * @throws {Error} Si falta al menos una de ellas.
 */
function assertComplete(
  settings: DiscreteConnectionSettings
): asserts settings is { [K in keyof DiscreteConnectionSettings]: string } {
  const { hostname, username, password, database } = settings;
  if (!hostname || !username || !password || !database) {
    throw new Error(
      `${ERROR_PREFIX} Configuración PostgreSQL incompleta: define DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD y DATABASE_NAME.`
    );
  }
}

/**
 * Convierte una variable de entorno en un entero positivo seguro.
 *
 * @param value - Valor crudo de la variable de entorno.
 * @param fallback - Valor a usar cuando la variable no está definida o está en blanco.
 * @param name - Nombre de la variable, usado en el mensaje de error.
 * @returns El entero positivo parseado, o `fallback` si no hay valor.
 * @throws {Error} Si el valor no es un entero positivo seguro.
 */
function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${ERROR_PREFIX} ${name} debe ser un entero positivo.`);
  }
  return parsed;
}

/**
 * Verifica que la cadena de conexión sea una URL válida con protocolo PostgreSQL.
 *
 * @param value - Valor de `DATABASE_URL` ya recortado.
 * @throws {Error} Si no es una URL válida o su protocolo no es `postgres:` ni `postgresql:`.
 */
function assertPostgresConnectionString(value: string): void {
  if (!hasPostgresProtocol(value)) {
    throw new Error(`${ERROR_PREFIX} DATABASE_URL debe usar el protocolo postgres:// o postgresql://.`);
  }
}

/** Indica si el valor es una URL parseable cuyo protocolo es de PostgreSQL. */
function hasPostgresProtocol(value: string): boolean {
  try {
    return ALLOWED_POSTGRES_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
