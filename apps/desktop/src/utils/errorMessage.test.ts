import { describe, expect, test } from "bun:test";
import { getUnknownErrorMessage } from "./errorMessage";

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
