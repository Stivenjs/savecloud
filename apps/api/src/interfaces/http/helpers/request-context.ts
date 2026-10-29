import type { FastifyRequest } from "fastify";
import { ApplicationError } from "@application/errors/ApplicationError";

export function getUserId(request: FastifyRequest): string {
  const userId = request.scAuthenticatedUserId;
  if (typeof userId !== "string" || !userId.trim()) {
    throw new ApplicationError("UNAUTHENTICATED", "Falta el identificador de usuario autenticado.");
  }
  return userId.trim();
}
