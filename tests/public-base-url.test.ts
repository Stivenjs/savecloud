import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getPublicBaseUrl } from "@interfaces/http/helpers/public-base-url";

type MockRequest = Parameters<typeof getPublicBaseUrl>[0];

describe("getPublicBaseUrl", () => {
  const originalShareBaseUrl = process.env.SHARE_BASE_URL;

  beforeEach(() => {
    delete process.env.SHARE_BASE_URL;
  });

  afterEach(() => {
    if (originalShareBaseUrl !== undefined) {
      process.env.SHARE_BASE_URL = originalShareBaseUrl;
    } else {
      delete process.env.SHARE_BASE_URL;
    }
  });

  test("debe generar http para localhost en Docker/desarrollo local cuando no hay proxy https", () => {
    const mockReq = {
      headers: {
        host: "localhost:3000",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("http://localhost:3000");
  });

  test("debe generar http para 127.0.0.1:3000", () => {
    const mockReq = {
      headers: {
        host: "127.0.0.1:3000",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("http://127.0.0.1:3000");
  });

  test("debe generar http para savecloud-api:3000 dentro de la red Docker", () => {
    const mockReq = {
      headers: {
        host: "savecloud-api:3000",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("http://savecloud-api:3000");
  });

  test("debe respetar x-forwarded-proto https en dominio VPS o proxy", () => {
    const mockReq = {
      headers: {
        host: "savecloud.example.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("https://savecloud.example.com");
  });

  test("debe respetar x-forwarded-host y x-forwarded-proto con lista separada por comas", () => {
    const mockReq = {
      headers: {
        host: "internal-service",
        "x-forwarded-host": "savecloud.example.com",
        "x-forwarded-proto": "https, http",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("https://savecloud.example.com");
  });

  test("debe priorizar SHARE_BASE_URL si está definido en el entorno", () => {
    process.env.SHARE_BASE_URL = "https://custom-clips.example.com/";
    const mockReq = {
      headers: {
        host: "localhost:3000",
      },
      protocol: "http",
    } as unknown as MockRequest;

    expect(getPublicBaseUrl(mockReq)).toBe("https://custom-clips.example.com");
  });
});
