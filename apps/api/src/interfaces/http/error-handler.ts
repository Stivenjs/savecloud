import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import type { ApiProblemDetails } from "@savecloud/types";
import { ApplicationError, type ApplicationErrorCode } from "@application/errors/ApplicationError";

interface HttpErrorDetails {
  status: number;
  label: string;
  message: string;
}

const APPLICATION_ERROR_DETAILS: Record<ApplicationErrorCode, Omit<HttpErrorDetails, "message">> = {
  INVALID_ARGUMENT: { status: 400, label: "Bad Request" },
  VALIDATION_ERROR: { status: 400, label: "Bad Request" },
  UNAUTHENTICATED: { status: 401, label: "Unauthorized" },
  FORBIDDEN: { status: 403, label: "Forbidden" },
  NOT_FOUND: { status: 404, label: "Not Found" },
  CONFLICT: { status: 409, label: "Conflict" },
  GONE: { status: 410, label: "Gone" },
  REQUEST_TIMEOUT: { status: 408, label: "Request Timeout" },
  PAYLOAD_TOO_LARGE: { status: 413, label: "Payload Too Large" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, label: "Unsupported Media Type" },
  UNPROCESSABLE_ENTITY: { status: 422, label: "Unprocessable Entity" },
  RATE_LIMITED: { status: 429, label: "Too Many Requests" },
  UPSTREAM_FAILURE: { status: 502, label: "Bad Gateway" },
  NOT_IMPLEMENTED: { status: 501, label: "Not Implemented" },
  SERVICE_UNAVAILABLE: { status: 503, label: "Service Unavailable" },
  GATEWAY_TIMEOUT: { status: 504, label: "Gateway Timeout" },
};

const FASTIFY_ERROR_CODES: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
  501: "NOT_IMPLEMENTED",
  502: "UPSTREAM_FAILURE",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

function fastifyErrorDetails(error: unknown): HttpErrorDetails | null {
  if (!error || typeof error !== "object") return null;
  const fastifyError = error as FastifyError;
  const status = typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : null;
  if (status === null) return null;

  if (fastifyError.validation) {
    return {
      status: 400,
      label: "Bad Request",
      message: "La solicitud no cumple el formato esperado.",
    };
  }

  if (status === 429) {
    return { status, label: "Too Many Requests", message: "Se alcanzó el límite de solicitudes." };
  }
  if (status === 408) {
    return { status, label: "Request Timeout", message: "La solicitud tardó demasiado. Inténtalo de nuevo." };
  }
  if (status === 413) {
    return { status, label: "Payload Too Large", message: "El archivo o la solicitud supera el tamaño permitido." };
  }
  if (status === 415) {
    return { status, label: "Unsupported Media Type", message: "El formato enviado no es compatible." };
  }
  if (status === 422) {
    return { status, label: "Unprocessable Entity", message: "Los datos enviados no se pueden procesar." };
  }

  const knownServerErrors: Record<number, HttpErrorDetails> = {
    501: { status, label: "Not Implemented", message: "Esta operación no está disponible." },
    502: { status, label: "Bad Gateway", message: "Un servicio necesario no respondió correctamente." },
    503: { status, label: "Service Unavailable", message: "El servicio no está disponible temporalmente." },
    504: { status, label: "Gateway Timeout", message: "Un servicio necesario tardó demasiado en responder." },
  };
  if (knownServerErrors[status]) return knownServerErrors[status];
  if (status < 400 || status > 499) return null;

  const labels: Record<number, string> = {
    400: "Bad Request",
    408: "Request Timeout",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    410: "Gone",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
  };

  return {
    status,
    label: labels[status] ?? "Client Error",
    message: "La solicitud no se pudo procesar.",
  };
}

export function registerHttpErrorHandler(app: FastifyInstance): void {
  const sendProblem = (
    reply: FastifyReply,
    input: { status: number; title: string; detail: string; code: string; requestId: string }
  ) => {
    const { status, title, detail, code, requestId } = input;
    const problem: ApiProblemDetails = {
      type: "about:blank",
      title,
      status,
      detail,
      instance: `urn:savecloud:request:${encodeURIComponent(requestId)}`,
      code,
      requestId,
      error: title,
      message: detail,
      statusCode: status,
    };

    return reply.status(status).header("x-request-id", requestId).type("application/problem+json").send(problem);
  };

  app.setErrorHandler((error, request, reply) => {
    let details: HttpErrorDetails;
    let code: string;

    if (error instanceof ApplicationError) {
      const mapped = APPLICATION_ERROR_DETAILS[error.code];
      details = { ...mapped, message: error.message };
      code = error.code;
    } else {
      const clientError = fastifyErrorDetails(error);
      if (clientError) {
        details = clientError;
        code = (error as FastifyError).validation
          ? "VALIDATION_ERROR"
          : (FASTIFY_ERROR_CODES[clientError.status] ?? `HTTP_${clientError.status}`);
      } else {
        details = {
          status: 500,
          label: "Internal Server Error",
          message: "Ocurrió un error interno. Inténtalo de nuevo más tarde.",
        };
        code = "INTERNAL_ERROR";
      }
    }

    if (details.status >= 500) {
      request.log.error({ err: error, code }, "Falló una solicitud HTTP");
    } else {
      request.log.info({ code, statusCode: details.status }, "Solicitud HTTP rechazada");
    }

    return sendProblem(reply, {
      status: details.status,
      title: details.label,
      detail: details.message,
      code,
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.info({ code: "NOT_FOUND", statusCode: 404 }, "Ruta HTTP no encontrada");
    return sendProblem(reply, {
      status: 404,
      title: "Not Found",
      detail: "La ruta solicitada no existe.",
      code: "NOT_FOUND",
      requestId: request.id,
    });
  });
}
