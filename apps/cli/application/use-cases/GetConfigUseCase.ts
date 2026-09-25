import type { Config } from "@cli/domain/entities/Config";
import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";

/**
 * Devuelve la configuración completa y permite guardarla.
 * Útil para comandos que necesitan leer o modificar la config global.
 */
export class GetConfigUseCase {
  constructor(private readonly configRepository: ConfigRepository) {}

  async execute(): Promise<Config> {
    return this.configRepository.load();
  }

  async save(config: Config): Promise<void> {
    return this.configRepository.save(config);
  }
}
