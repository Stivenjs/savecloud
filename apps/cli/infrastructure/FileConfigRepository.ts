import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { userInfo } from "os";
import { dirname } from "path";
import type { Config } from "@cli/domain/entities/Config";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from "@cli/infrastructure/configConstants";

const DEFAULT_API_BASE_URL = process.env.SYNC_GAMES_API_URL ?? "";
const DEFAULT_API_KEY = process.env.SYNC_GAMES_API_KEY ?? "";

function getDefaultUserId(): string {
  return (userInfo().username || process.env.USERNAME || process.env.USER || "default-user").toLowerCase();
}

function getConfigDir(): string {
  const base =
    process.env.APPDATA ||
    (process.platform === "darwin" ? `${process.env.HOME}/Library/Application Support` : `${process.env.HOME}/.config`);
  return `${base}/${CONFIG_DIR_NAME}`;
}

/**
 * Implementación del puerto ConfigRepository: archivo JSON en directorio de config del SO.
 * Windows: %APPDATA%/SaveCloud/config.json
 * macOS: ~/Library/Application Support/SaveCloud/config.json
 * Linux: ~/.config/SaveCloud/config.json
 */
export class FileConfigRepository implements ConfigRepository {
  private readonly configPath: string;

  constructor() {
    this.configPath = `${getConfigDir()}/${CONFIG_FILE_NAME}`;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async load(): Promise<Config> {
    if (!existsSync(this.configPath)) {
      return {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiKey: DEFAULT_API_KEY,
        userId: getDefaultUserId(),
        games: [],
      };
    }
    const raw = readFileSync(this.configPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      apiBaseUrl?: string;
      apiKey?: string;
      userId?: string;
      games?: Array<{ id: string; paths: string[] }>;
      customScanPaths?: string[];
    };
    return {
      apiBaseUrl: parsed.apiBaseUrl || DEFAULT_API_BASE_URL,
      apiKey: parsed.apiKey || DEFAULT_API_KEY,
      userId: parsed.userId || getDefaultUserId(),
      games: Array.isArray(parsed.games) ? parsed.games : [],
      customScanPaths: Array.isArray(parsed.customScanPaths) ? parsed.customScanPaths : [],
    };
  }

  async save(config: Config): Promise<void> {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(
      {
        apiBaseUrl: config.apiBaseUrl,
        userId: config.userId,
        games: config.games,
        customScanPaths: config.customScanPaths,
      },
      null,
      2
    );
    writeFileSync(this.configPath, json, "utf-8");
  }
}
