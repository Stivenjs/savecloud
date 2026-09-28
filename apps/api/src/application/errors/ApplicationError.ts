export type ApplicationErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "UPSTREAM_FAILURE"
  | "NOT_IMPLEMENTED"
  | "SERVICE_UNAVAILABLE";

/** Error de negocio con un código estable que la interfaz HTTP traduce a un estado. */
export class ApplicationError extends Error {
  constructor(
    public readonly code: ApplicationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
