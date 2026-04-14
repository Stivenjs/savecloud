import type { Config } from "@cli/domain/entities/Config";

/**
 * Puerto para leer y escribir la configuración del CLI.
 * La implementación (archivo en disco, formato JSON) vive en infrastructure.
 */
export interface ConfigRepository {
  getConfigPath(): string;
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}
