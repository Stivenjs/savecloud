import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ApplicationError } from "@application/errors/ApplicationError";
import { registerHttpErrorHandler } from "@interfaces/http/error-handler";

describe("HTTP error contract", () => {
  async function makeApp() {
    const app = Fastify({ logger: false });
    registerHttpErrorHandler(app);
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
      expect(response.json()).toMatchObject({ status: 429, code: "HTTP_429" });
    } finally {
      await app.close();
    }
  });
});
