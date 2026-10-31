import { createRequire } from "node:module";
import { describe, expect, test } from "bun:test";
import { registerHttpErrorHandler } from "@interfaces/http/error-handler";
import { registerInviteRoutes } from "@interfaces/http/routes/invites.routes";

interface TestApp {
  register(plugin: unknown, options: unknown): Promise<void>;
  post(path: string, options: unknown, handler: unknown): void;
  ready(): Promise<void>;
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>;
  close(): Promise<void>;
}

const requireApiDependency = createRequire(new URL("../apps/api/package.json", import.meta.url));
const Fastify = requireApiDependency("fastify") as (options: { logger: boolean }) => TestApp;
const rateLimit = requireApiDependency("@fastify/rate-limit");

describe("invite creation rate limit", () => {
  test("allows thirty invitations per minute per user and rejects the next one", async () => {
    const app = Fastify({ logger: false });
    registerHttpErrorHandler(app as unknown as Parameters<typeof registerHttpErrorHandler>[0]);
    await app.register(rateLimit, { global: false });

    (app as any).addHook("onRequest", async (request: any) => {
      const userId = request.headers["x-user-id"];
      if (typeof userId === "string" && userId.trim()) {
        request.scAuthenticatedUserId = userId.trim();
        request.scRateLimitUserId = userId.trim();
      }
    });

    const createCloudInviteUseCase = {
      execute: async (input: { hostUserId: string; inviteeUserId?: string }) => {
        const now = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          hostUserId: input.hostUserId,
          inviteeUserId: input.inviteeUserId ?? null,
          token: "a".repeat(48),
          status: "pending" as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    };
    await registerInviteRoutes(
      app as unknown as Parameters<typeof registerInviteRoutes>[0],
      {
        createCloudInviteUseCase,
      } as unknown as Parameters<typeof registerInviteRoutes>[1]
    );
    await app.ready();

    try {
      const createInvite = (userId: string) =>
        app.inject({
          method: "POST",
          url: "/invites",
          headers: { "x-user-id": userId, host: "localhost:3000" },
          payload: { withToken: true },
        });

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await createInvite("host-user");
        expect(response.statusCode).toBe(200);
      }

      const limitedResponse = await createInvite("host-user");
      expect(limitedResponse.statusCode).toBe(429);
      expect(limitedResponse.json()).toMatchObject({ status: 429, code: "RATE_LIMITED" });

      const otherUserResponse = await createInvite("another-host");
      expect(otherUserResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
