import type { FastifyRequest } from "fastify";
import { ApplicationError } from "@application/errors/ApplicationError";

export function getUserId(request: FastifyRequest): string {
  const userId = request.scAuthenticatedUserId;
  if (typeof userId !== "string" || !userId.trim()) {
    throw new ApplicationError("UNAUTHENTICATED", "Falta el identificador de usuario autenticado.");
  }
  return userId.trim();
}

/** Obtiene el ID declarado únicamente para flujos bootstrap protegidos por una invitación/token. */
export function getBootstrapUserId(request: FastifyRequest): string {
  const value = request.headers["x-user-id"];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApplicationError("UNAUTHENTICATED", "Falta el identificador local requerido para aceptar la invitación.");
  }
  return value.trim();
}
