export type RuntimeDeploymentMode = "lambda" | "self-hosted";

const REQUIRED_SETTINGS: Record<RuntimeDeploymentMode, string[]> = {
  lambda: [
    "AWS_REGION",
    "BUCKET_NAME",
    "API_KEY",
    "DOWNLOAD_BASE_URL",
    "WS_ENDPOINT",
    "GAME_STATS_TABLE",
    "SAVE_FILES_INDEX_TABLE",
    "CONNECTIONS_TABLE",
    "CLIPS_TABLE",
    "NOTIFICATIONS_TABLE",
    "SHARE_TOKENS_TABLE",
    "CLOUD_INVITES_TABLE",
    "GAME_INVENTORY_TABLE",
  ],
  "self-hosted": [
    "AWS_REGION",
    "BUCKET_NAME",
    "API_KEY",
    "DOWNLOAD_BASE_URL",
    "GAME_STATS_TABLE",
    "SAVE_FILES_INDEX_TABLE",
    "CONNECTIONS_TABLE",
    "CLIPS_TABLE",
    "NOTIFICATIONS_TABLE",
    "SHARE_TOKENS_TABLE",
    "CLOUD_INVITES_TABLE",
    "GAME_INVENTORY_TABLE",
  ],
};

/** Valida las variables y URLs que cada modo necesita antes de construir sus adaptadores. */
export function validateRuntimeConfiguration(mode: RuntimeDeploymentMode, env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_SETTINGS[mode].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`[bootstrap] Configuración incompleta para modo ${mode}. Faltan: ${missing.join(", ")}.`);
  }

  validateUrl("DOWNLOAD_BASE_URL", env.DOWNLOAD_BASE_URL);
  if (mode === "lambda") validateUrl("WS_ENDPOINT", env.WS_ENDPOINT);
}

function validateUrl(name: string, value: string | undefined): void {
  if (!value?.trim()) return;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[bootstrap] Configuración inválida: ${name} debe ser una URL absoluta.`);
  }

  const allowedProtocols = name === "WS_ENDPOINT" ? ["https:", "http:", "wss:", "ws:"] : ["https:", "http:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`[bootstrap] Configuración inválida: protocolo no permitido en ${name}.`);
  }
}
