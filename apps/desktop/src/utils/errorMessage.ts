import i18n from "@lib/i18n";

function messageFromStructuredError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const error = value as { code?: unknown; detail?: unknown; message?: unknown; title?: unknown };
  const code = typeof error.code === "string" ? error.code : "";
  const detail = typeof error.detail === "string" ? error.detail.trim() : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  const title = typeof error.title === "string" ? error.title.trim() : "";
  const selectedMessage = detail || message || title;

  const mapped = messageForCode(code);
  if (mapped && shouldPreferMappedMessage(code)) return mapped;
  const status = (value as { status?: unknown; statusCode?: unknown }).status;
  const legacyStatus = (value as { status?: unknown; statusCode?: unknown }).statusCode;
  if ((typeof status === "number" && status >= 500) || (typeof legacyStatus === "number" && legacyStatus >= 500)) {
    return i18n.t("errors.serverFailure");
  }
  if (selectedMessage) return localizeGenericServerError(selectedMessage);
  return mapped;
}

function shouldPreferMappedMessage(code: string): boolean {
  return [
    "INTERNAL_ERROR",
    "UNKNOWN_ERROR",
    "UPSTREAM_FAILURE",
    "NETWORK_ERROR",
    "REQUEST_TIMEOUT",
    "SERVICE_UNAVAILABLE",
    "HTTP_503",
    "GATEWAY_TIMEOUT",
    "HTTP_504",
    "HTTP_408",
  ].includes(code);
}

function messageForCode(code: string): string | null {
  switch (code) {
    case "INTERNAL_ERROR":
    case "UNKNOWN_ERROR":
      return i18n.t("errors.serverFailure");
    case "UPSTREAM_FAILURE":
    case "HTTP_502":
      return i18n.t("errors.upstreamFailure");
    case "NETWORK_ERROR":
      return i18n.t("errors.networkFailure");
    case "REQUEST_TIMEOUT":
    case "HTTP_408":
      return i18n.t("errors.requestTimeout");
    case "UNAUTHENTICATED":
    case "HTTP_401":
      return i18n.t("errors.unauthenticated");
    case "FORBIDDEN":
    case "HTTP_403":
      return i18n.t("errors.forbidden");
    case "VALIDATION_ERROR":
    case "HTTP_400":
      return i18n.t("errors.validationFailure");
    case "RATE_LIMITED":
    case "HTTP_429":
      return i18n.t("errors.rateLimited");
    case "PAYLOAD_TOO_LARGE":
    case "HTTP_413":
      return i18n.t("errors.payloadTooLarge");
    case "UNSUPPORTED_MEDIA_TYPE":
    case "HTTP_415":
      return i18n.t("errors.unsupportedMediaType");
    case "UNPROCESSABLE_ENTITY":
    case "HTTP_422":
      return i18n.t("errors.unprocessableEntity");
    case "SERVICE_UNAVAILABLE":
    case "HTTP_503":
      return i18n.t("errors.serviceUnavailable");
    case "GATEWAY_TIMEOUT":
    case "HTTP_504":
      return i18n.t("errors.gatewayTimeout");
    default:
      return null;
  }
}

function parsePayloadMessage(source: string): string | null {
  const objectStart = source.indexOf("{");
  if (objectStart < 0) return null;

  try {
    const parsed: unknown = JSON.parse(source.slice(objectStart));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const body = parsed as {
      code?: unknown;
      message?: unknown;
      detail?: unknown;
      error?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const errorCode = typeof body.code === "string" ? body.code : "";
    const mapped = messageForCode(errorCode);
    if (mapped && shouldPreferMappedMessage(errorCode)) return mapped;
    if (
      (typeof body.status === "number" && body.status >= 500) ||
      (typeof body.statusCode === "number" && body.statusCode >= 500)
    ) {
      return i18n.t("errors.serverFailure");
    }
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail.trim();
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
    if (typeof body.error === "string" && body.error.trim()) {
      return /^internal server error$/i.test(body.error.trim()) ? i18n.t("errors.serverFailure") : body.error.trim();
    }
    if (mapped) return mapped;
  } catch {
    // Algunos comandos de Rust imprimen el cuerpo como `Error { ... }`.
  }

  return null;
}

function localizeGenericServerError(message: string): string {
  return /^internal server error$/i.test(message.trim()) ? i18n.t("errors.serverFailure") : message;
}

function unwrapApiError(message: string): string {
  const trimmed = message.trim();
  const apiMatch = trimmed.match(/^API\s*Error\s*\([^)]*\)\s*:\s*/i);
  const payload = apiMatch ? trimmed.slice(apiMatch[0].length).trim() : trimmed;
  if (
    /^(?:network|request) error\b|failed to (?:connect|send request|fetch)|error sending request|error connecting|connection (?:refused|reset)|timed out|dns error/i.test(
      payload
    )
  ) {
    return i18n.t("errors.networkFailure");
  }
  const payloadMessage = parsePayloadMessage(payload);
  if (payloadMessage) return localizeGenericServerError(payloadMessage);

  const routeError = payload.match(/^API\s+\w+\s+[^:]+:\s+(\d{3})\s+([^\n]+)/i);
  if (routeError) {
    const status = Number(routeError[1]);
    const statusMessage = routeError[2].trim();
    if (status >= 500 || /internal server error/i.test(statusMessage)) return i18n.t("errors.serverFailure");
    return statusMessage;
  }

  return localizeGenericServerError(payload);
}

export function getUnknownErrorMessage(err: unknown, fallback = i18n.t("errors.unexpected")): string {
  if (err instanceof Error && err.message?.trim()) return unwrapApiError(err.message);
  if (typeof err === "string" && err.trim()) return unwrapApiError(err);
  const structuredMessage = messageFromStructuredError(err);
  if (structuredMessage) return structuredMessage;
  return fallback;
}
