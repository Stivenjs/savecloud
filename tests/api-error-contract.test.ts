import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { ApplicationError } from "@application/errors/ApplicationError";
import { registerHttpErrorHandler } from "@interfaces/http/error-handler";

interface TestApp {
  get(path: string, optionsOrHandler: unknown, handler?: () => unknown): void;
  register(plugin: unknown, options: unknown): Promise<void>;
  ready(): Promise<void>;
  inject(options: { method: string; url: string }): Promise<{
    statusCode: number;
    headers: Record<string, string | undefined>;
    body: string;
    json(): Record<string, unknown>;
  }>;
  close(): Promise<void>;
}

const requireApiDependency = createRequire(new URL("../apps/api/package.json", import.meta.url));
const Fastify = requireApiDependency("fastify") as (options: { logger: boolean }) => TestApp;
const rateLimit = requireApiDependency("@fastify/rate-limit");

describe("HTTP error contract", () => {
  async function makeApp() {
    const app = Fastify({ logger: false });
    registerHttpErrorHandler(app as unknown as Parameters<typeof registerHttpErrorHandler>[0]);
    app.get("/business-error", async () => {
      throw new ApplicationError("CONFLICT", "Ese identificador ya está ocupado.");
    });
    app.get("/unexpected-error", async () => {
      throw new Error("secret database details");
    });
    app.get("/validation-error", { schema: { querystring: { type: "object", required: ["id"] } } }, async () => ({
      ok: true,
    }));
    await app.register(rateLimit, { global: false });
    app.get("/rate-limited", { config: { rateLimit: { max: 1, timeWindow: 60_000 } } }, async () => ({ ok: true }));
    for (const statusCode of [408, 413, 415, 422, 501, 502, 503, 504]) {
      app.get(`/http-${statusCode}`, async () => {
        throw Object.assign(new Error("private upstream details"), { statusCode });
      });
    }
    await app.ready();
    return app;
  }

  test("uses RFC 9457 fields and a stable code for application errors", async () => {
    const app = await makeApp();
    try {
      const response = await app.inject({ method: "GET", url: "/business-error" });
      const body = response.json();

      expect(response.statusCode).toBe(409);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(body).toMatchObject({
        type: "about:blank",
        status: 409,
        code: "CONFLICT",
        detail: "Ese identificador ya está ocupado.",
        statusCode: 409,
        message: "Ese identificador ya está ocupado.",
      });
      expect(response.headers["x-request-id"]).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  test("returns structured 404 errors for missing routes", async () => {
    const app = await makeApp();
    try {
      const response = await app.inject({ method: "GET", url: "/missing" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ status: 404, code: "NOT_FOUND" });
    } finally {
      await app.close();
    }
  });

  test("does not expose internal exception details", async () => {
    const app = await makeApp();
    try {
      const response = await app.inject({ method: "GET", url: "/unexpected-error" });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
      expect(response.body).not.toContain("secret database details");
    } finally {
      await app.close();
    }
  });

  test("normalizes Fastify validation errors", async () => {
    const app = await makeApp();
    try {
      const response = await app.inject({ method: "GET", url: "/validation-error" });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    } finally {
      await app.close();
    }
  });

  test("normalizes rate-limit errors thrown by the Fastify plugin", async () => {
    const app = await makeApp();
    try {
      await app.inject({ method: "GET", url: "/rate-limited" });
      const response = await app.inject({ method: "GET", url: "/rate-limited" });
      expect(response.statusCode).toBe(429);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    } finally {
      await app.close();
    }
  });

  test("assigns stable codes and safe messages to common Fastify HTTP errors", async () => {
    const cases = [
      [408, "REQUEST_TIMEOUT"],
      [413, "PAYLOAD_TOO_LARGE"],
      [415, "UNSUPPORTED_MEDIA_TYPE"],
      [422, "UNPROCESSABLE_ENTITY"],
      [501, "NOT_IMPLEMENTED"],
      [502, "UPSTREAM_FAILURE"],
      [503, "SERVICE_UNAVAILABLE"],
      [504, "GATEWAY_TIMEOUT"],
    ] as const;
    const app = await makeApp();
    try {
      for (const [status, code] of cases) {
        const response = await app.inject({ method: "GET", url: `/http-${status}` });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toMatchObject({ status, code });
        expect(response.body).not.toContain("private upstream details");
      }
    } finally {
      await app.close();
    }
  });
});
