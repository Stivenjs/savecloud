import { describe, expect, test } from "bun:test";
import i18n from "../apps/desktop/src/lib/i18n";
import { getUnknownErrorMessage } from "../apps/desktop/src/utils/errorMessage";

describe("getUnknownErrorMessage", () => {
  test("maps structured server failures to the localized safe message", () => {
    expect(
      getUnknownErrorMessage({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Ocurrió un error en el servidor.",
        code: "INTERNAL_ERROR",
        requestId: "request-123",
      })
    ).toBe("El servidor tuvo un problema. Inténtalo de nuevo más tarde.");
  });

  test("reads legacy API envelopes without displaying their JSON wrapper", () => {
    expect(
      getUnknownErrorMessage(
        new Error(
          'API Error (400 Bad Request): {"error":"Bad Request","message":"No puedes enviarte una invitación a ti mismo.","code":"INVALID_ARGUMENT"}'
        )
      )
    ).toBe("No puedes enviarte una invitación a ti mismo.");
  });

  test("preserves the API's specific explanation for forbidden actions", () => {
    const detail = "No puedes aceptar tu propia invitación.";

    expect(getUnknownErrorMessage({ code: "FORBIDDEN", status: 403, message: detail, retryable: false })).toBe(detail);
    expect(getUnknownErrorMessage(new Error(JSON.stringify({ code: "FORBIDDEN", status: 403, message: detail })))).toBe(
      detail
    );
  });

  test("uses a generic forbidden message only when the server has no explanation", () => {
    expect(getUnknownErrorMessage({ code: "FORBIDDEN", status: 403 })).toBe(
      "No tienes permiso para realizar esta acción."
    );
  });

  test("provides localized fallbacks for common HTTP error codes", () => {
    expect(getUnknownErrorMessage({ code: "VALIDATION_ERROR", status: 400 })).toBe(
      "Revisa los datos: falta información o algún campo tiene un formato incorrecto."
    );
    expect(getUnknownErrorMessage({ code: "RATE_LIMITED", status: 429 })).toBe(
      "Hiciste demasiadas solicitudes. Espera un momento antes de volver a intentarlo."
    );
    expect(getUnknownErrorMessage({ code: "PAYLOAD_TOO_LARGE", status: 413 })).toBe(
      "El archivo o la solicitud supera el tamaño permitido."
    );
    expect(getUnknownErrorMessage({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 })).toBe(
      "El formato enviado no es compatible."
    );
    expect(getUnknownErrorMessage({ code: "UNPROCESSABLE_ENTITY", status: 422 })).toBe(
      "Los datos enviados no se pueden procesar."
    );
    expect(getUnknownErrorMessage({ code: "REQUEST_TIMEOUT", status: 408 })).toBe(
      "La solicitud tardó demasiado. Inténtalo de nuevo."
    );
    expect(getUnknownErrorMessage({ code: "UPSTREAM_FAILURE", status: 502 })).toBe(
      "Un servicio necesario no respondió correctamente. Inténtalo de nuevo."
    );
    expect(getUnknownErrorMessage({ code: "GATEWAY_TIMEOUT", status: 504 })).toBe(
      "Un servicio necesario tardó demasiado en responder. Inténtalo de nuevo."
    );
  });

  test("localizes rate-limit details to the active app language", async () => {
    const previousLanguage = i18n.language;

    try {
      await i18n.changeLanguage("en");
      expect(
        getUnknownErrorMessage({
          code: "RATE_LIMITED",
          status: 429,
          detail: "Se alcanzó el límite de solicitudes.",
        })
      ).toBe("Too many requests. Wait a moment before trying again.");
    } finally {
      await i18n.changeLanguage(previousLanguage);
    }
  });

  test("hides server details from legacy 500 envelopes", () => {
    expect(
      getUnknownErrorMessage('{"error":"Internal Server Error","message":"secret database details","statusCode":500}')
    ).toBe("El servidor tuvo un problema. Inténtalo de nuevo más tarde.");
  });

  test("maps transport-level connection failures", () => {
    expect(getUnknownErrorMessage(new Error("error sending request for url (https://api.example.com)"))).toBe(
      "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."
    );
  });

  test("maps browser fetch failures to the same network message", () => {
    expect(getUnknownErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."
    );
  });
});
