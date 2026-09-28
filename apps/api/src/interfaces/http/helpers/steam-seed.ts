import { ApplicationError } from "@application/errors/ApplicationError";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";

export function assertSteamSeedRepository(
  repository: SteamSeedRepository | undefined
): asserts repository is SteamSeedRepository {
  if (!repository) {
    throw new ApplicationError("NOT_IMPLEMENTED", "El repositorio Steam Seed no está habilitado.");
  }
}
