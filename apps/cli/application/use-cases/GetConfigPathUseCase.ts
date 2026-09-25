import type { ConfigRepository } from "@cli/domain/ports/ConfigRepository";

export interface GetConfigPathOutput {
  configPath: string;
}

/**
 * Devuelve la ruta del archivo de configuración.
 */
export class GetConfigPathUseCase {
  constructor(private readonly configRepository: ConfigRepository) {}

  execute(): GetConfigPathOutput {
    return {
      configPath: this.configRepository.getConfigPath(),
    };
  }
}
