export type ApplicationErrorCode =
  | "INVALID_ARGUMENT"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "REQUEST_TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "NOT_IMPLEMENTED"
  | "SERVICE_UNAVAILABLE"
  | "GATEWAY_TIMEOUT";

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
