import type { GameStat } from "@domain/entities/GameStat";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";

/**
 * Caso de uso: Consultar agregados/stats de la cuenta del usuario desde la base de datos veloz (DynamoDB).
 * Permite renderizar "mis juegos", "pesos" y "última sincronización".
 */
export class GetGameSummaryUseCase {
  constructor(private readonly gameStatRepository: GameStatRepository) {}

  /**
   * Ejecuta la consulta de stats en DynamoDB en menos de 30ms aprox.
   * @param userId - Identificador principal
   */
  async execute(userId: string): Promise<GameStat[]> {
    return this.gameStatRepository.listByUser(userId);
  }
}
