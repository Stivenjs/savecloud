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
  UNAUTHENTICATED: { status: 401, label: "Unauthorized" },
  FORBIDDEN: { status: 403, label: "Forbidden" },
  NOT_FOUND: { status: 404, label: "Not Found" },
  CONFLICT: { status: 409, label: "Conflict" },
  GONE: { status: 410, label: "Gone" },
  UPSTREAM_FAILURE: { status: 502, label: "Bad Gateway" },
  NOT_IMPLEMENTED: { status: 501, label: "Not Implemented" },
  SERVICE_UNAVAILABLE: { status: 503, label: "Service Unavailable" },
};

function fastifyErrorDetails(error: unknown): HttpErrorDetails | null {
  if (!error || typeof error !== "object") return null;
  const fastifyError = error as FastifyError;
  const status = typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : null;
  if (status === null || status < 400 || status > 499) return null;

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

  const labels: Record<number, string> = {
    400: "Bad Request",
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
        code = (error as FastifyError).validation ? "VALIDATION_ERROR" : `HTTP_${clientError.status}`;
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
