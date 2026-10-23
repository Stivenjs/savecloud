/** Opciones de logging de HTTP resueltas para el entorno actual. */
export interface HttpLoggingConfig {
  level: string;
  requestLoggingEnabled: boolean;
}

/**
 * Resuelve el nivel y el registro de solicitudes según el entorno y sus overrides.
 * Desarrollo registra solicitudes de forma predeterminada; producción requiere activación explícita.
 */
export function resolveHttpLoggingConfig(env: NodeJS.ProcessEnv = process.env): HttpLoggingConfig {
  const isProduction = env.NODE_ENV === "production";
  const requestLoggingEnabled =
    env.HTTP_REQUEST_LOGS === "true" || (env.HTTP_REQUEST_LOGS !== "false" && !isProduction);

  return {
    level: env.LOG_LEVEL ?? (isProduction ? "warn" : "info"),
    requestLoggingEnabled,
  };
}
