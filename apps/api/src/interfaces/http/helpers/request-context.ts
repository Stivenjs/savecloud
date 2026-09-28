import type { FastifyRequest } from "fastify";
import { ApplicationError } from "@application/errors/ApplicationError";

const USER_ID_HEADER = "x-user-id";

export function getUserId(request: FastifyRequest): string {
  const userId = request.headers[USER_ID_HEADER];
  if (typeof userId !== "string" || !userId.trim()) {
    throw new ApplicationError("UNAUTHENTICATED", "Falta el identificador de usuario autenticado.");
  }
  return userId.trim();
}
