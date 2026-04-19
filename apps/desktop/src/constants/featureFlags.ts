function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const envExperimentalCloudStreams = parseBooleanFlag(import.meta.env.VITE_EXPERIMENTAL_CLOUD_STREAMS);

/**
 * Flags globales para funcionalidades experimentales.
 * Regla actual: en desarrollo se habilitan por defecto.
 * En producción solo se habilitan si el flag VITE_EXPERIMENTAL_CLOUD_STREAMS=true.
 */
export const featureFlags = {
  experimentalCloudStreams: import.meta.env.DEV || envExperimentalCloudStreams,
} as const;
