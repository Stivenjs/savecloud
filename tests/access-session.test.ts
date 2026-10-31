import { describe, it, expect, beforeEach } from "bun:test";
import { createRequire } from "node:module";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { AccessSession } from "@domain/entities/AccessSession";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { CloudMembership } from "@domain/entities/CloudInvite";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_SESSION_TTL_SECONDS,
  createAccessSession,
  hashRefreshToken,
  parseRefreshToken,
  rotateAccessSession,
  secureHashEquals,
} from "@shared/accessSession";
import { verifyUserAccessToken } from "@shared/accessToken";
import { registerAuthRoutes, invalidateMembershipAuthCache } from "@interfaces/http/routes/auth.routes";
import { registerHttpErrorHandler } from "@interfaces/http/error-handler";

const requireApiDependency = createRequire(new URL("../apps/api/package.json", import.meta.url));
const Fastify = requireApiDependency("fastify");
const rateLimit = requireApiDependency("@fastify/rate-limit");

class InMemoryAccessSessionRepository implements AccessSessionRepository {
  private sessions = new Map<string, AccessSession>();
  public rotateCalls = 0;
  public revokeCalls: string[] = [];

  async create(session: AccessSession): Promise<void> {
    this.sessions.set(session.sessionId, { ...session });
  }

  async get(sessionId: string): Promise<AccessSession | null> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : null;
  }

  async rotateRefreshToken(
    sessionId: string,
    expectedTokenHash: string,
    nextTokenHash: string,
    expiresAtEpoch: number
  ): Promise<boolean> {
    this.rotateCalls++;
    const s = this.sessions.get(sessionId);
    if (
      !s ||
      !s.active ||
      s.refreshTokenHash !== expectedTokenHash ||
      s.expiresAtEpoch <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
    s.refreshTokenHash = nextTokenHash;
    s.expiresAtEpoch = expiresAtEpoch;
    this.sessions.set(sessionId, s);
    return true;
  }

  async revoke(sessionId: string): Promise<void> {
    this.revokeCalls.push(sessionId);
    const s = this.sessions.get(sessionId);
    if (s) {
      s.active = false;
      this.sessions.set(sessionId, s);
    }
  }

  async revokeMembershipSessions(hostUserId: string, userId: string): Promise<void> {
    for (const [id, s] of this.sessions.entries()) {
      if (s.hostUserId === hostUserId && s.userId === userId) {
        s.active = false;
        this.sessions.set(id, s);
      }
    }
  }
}

describe("AccessSession Service & Performance Suite", () => {
  let repository: InMemoryAccessSessionRepository;

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = "test-secret-key-32-chars-long-abc!!";
    repository = new InMemoryAccessSessionRepository();
  });

  describe("parseRefreshToken", () => {
    it("parses valid scr1 token correctly", () => {
      const validToken = "scr1.12345678-1234-1234-1234-1234567890ab.abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF";
      const parsed = parseRefreshToken(validToken);
      expect(parsed).not.toBeNull();
      expect(parsed?.sessionId).toBe("12345678-1234-1234-1234-1234567890ab");
      expect(parsed?.secret).toBe("abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF");
    });

    it("parses token with surrounding whitespace", () => {
      const validToken = "  scr1.12345678-1234-1234-1234-1234567890ab.abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF  ";
      const parsed = parseRefreshToken(validToken);
      expect(parsed).not.toBeNull();
      expect(parsed?.sessionId).toBe("12345678-1234-1234-1234-1234567890ab");
    });

    it("rejects token with missing prefix", () => {
      const invalid = "scr2.12345678-1234-1234-1234-1234567890ab.abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF";
      expect(parseRefreshToken(invalid)).toBeNull();
    });

    it("rejects token that is too short (fast-path)", () => {
      expect(parseRefreshToken("scr1.too-short")).toBeNull();
      expect(parseRefreshToken("")).toBeNull();
    });

    it("rejects non-string input safely", () => {
      expect(parseRefreshToken(null as unknown as string)).toBeNull();
      expect(parseRefreshToken(undefined as unknown as string)).toBeNull();
    });
  });

  describe("hashRefreshToken and secureHashEquals", () => {
    it("generates deterministic 64-char sha256 hex string", () => {
      const hash1 = hashRefreshToken("scr1.test-token");
      const hash2 = hashRefreshToken("scr1.test-token");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("secureHashEquals returns true for identical hashes", () => {
      const hash = hashRefreshToken("sample-secret");
      expect(secureHashEquals(hash, hash)).toBe(true);
    });

    it("secureHashEquals returns false for different hashes", () => {
      const h1 = hashRefreshToken("secret-1");
      const h2 = hashRefreshToken("secret-2");
      expect(secureHashEquals(h1, h2)).toBe(false);
    });

    it("secureHashEquals returns false immediately for invalid lengths (fast-path zero-allocation)", () => {
      expect(secureHashEquals("short", "short")).toBe(false);
      expect(secureHashEquals("", "")).toBe(false);
      expect(secureHashEquals("a".repeat(64), "a".repeat(63))).toBe(false);
    });
  });

  describe("createAccessSession", () => {
    it("creates an active session and returns valid tokens", async () => {
      const tokens = await createAccessSession(repository, "guest-user", "host-user");

      expect(tokens.userId).toBe("guest-user");
      expect(tokens.hostUserId).toBe("host-user");
      expect(tokens.refreshToken.startsWith("scr1.")).toBe(true);
      expect(tokens.accessToken.startsWith("sc2.")).toBe(true);
      const now = Math.floor(Date.now() / 1000);
      expect(tokens.accessTokenExpiresAt).toBeGreaterThanOrEqual(now + ACCESS_TOKEN_TTL_SECONDS - 2);
      expect(tokens.refreshTokenExpiresAt).toBeGreaterThanOrEqual(now + REFRESH_SESSION_TTL_SECONDS - 2);

      const parsed = parseRefreshToken(tokens.refreshToken);
      expect(parsed).not.toBeNull();

      const stored = await repository.get(parsed!.sessionId);
      expect(stored).not.toBeNull();
      expect(stored?.active).toBe(true);
      expect(stored?.userId).toBe("guest-user");
      expect(stored?.hostUserId).toBe("host-user");
      expect(stored?.refreshTokenHash).toBe(hashRefreshToken(tokens.refreshToken));

      // Verificamos que el access token emitido sea criptográficamente válido
      const verified = verifyUserAccessToken(tokens.accessToken);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe("guest-user");
      expect(verified?.hostUserId).toBe("host-user");
      expect(verified?.sessionId).toBe(parsed!.sessionId);
    });
  });

  describe("rotateAccessSession", () => {
    it("rotates token successfully and authorizes concurrently", async () => {
      const initial = await createAccessSession(repository, "guest-1", "host-1");
      let authorizeCalled = false;

      const rotated = await rotateAccessSession(repository, initial.refreshToken, async (session) => {
        authorizeCalled = true;
        expect(session.userId).toBe("guest-1");
        expect(session.hostUserId).toBe("host-1");
        return true;
      });

      expect(rotated).not.toBeNull();
      expect(authorizeCalled).toBe(true);
      expect(rotated?.userId).toBe("guest-1");
      expect(rotated?.hostUserId).toBe("host-1");
      expect(rotated?.refreshToken).not.toBe(initial.refreshToken);
      const verified = verifyUserAccessToken(rotated!.accessToken);
      expect(verified?.userId).toBe("guest-1");

      // El token anterior ya no debe ser válido para volver a rotar (Reuse Detection)
      const reused = await rotateAccessSession(repository, initial.refreshToken);
      expect(reused).toBeNull();

      // Debe haber revocado la sesión por intento de reutilización
      const parsed = parseRefreshToken(initial.refreshToken)!;
      const sessionAfterReuse = await repository.get(parsed.sessionId);
      expect(sessionAfterReuse?.active).toBe(false);
      expect(repository.revokeCalls).toContain(parsed.sessionId);
    });

    it("revokes session when authorize callback returns false", async () => {
      const initial = await createAccessSession(repository, "guest-2", "host-2");

      const rotated = await rotateAccessSession(
        repository,
        initial.refreshToken,
        async () => false // Membresía revocada
      );

      expect(rotated).toBeNull();
      const parsed = parseRefreshToken(initial.refreshToken)!;
      const session = await repository.get(parsed.sessionId);
      expect(session?.active).toBe(false);
    });

    it("rejects rotation for expired session", async () => {
      const initial = await createAccessSession(repository, "guest-3", "host-3");
      const parsed = parseRefreshToken(initial.refreshToken)!;

      // Forzar expiración
      const s = (await repository.get(parsed.sessionId))!;
      s.expiresAtEpoch = Math.floor(Date.now() / 1000) - 10;
      await repository.create(s);

      const rotated = await rotateAccessSession(repository, initial.refreshToken);
      expect(rotated).toBeNull();
    });

    it("rejects rotation for malformed token", async () => {
      const rotated = await rotateAccessSession(repository, "invalid-token");
      expect(rotated).toBeNull();
    });
  });

  describe("HTTP Endpoint POST /auth/refresh", () => {
    let mockInviteRepo: CloudInviteRepository;
    let getMembershipCalls = 0;

    beforeEach(() => {
      getMembershipCalls = 0;
      mockInviteRepo = {
        getMembership: async (hostUserId: string, memberUserId: string): Promise<CloudMembership | null> => {
          getMembershipCalls++;
          if (memberUserId === "guest-valid") {
            const nowIso = new Date().toISOString();
            return {
              hostUserId,
              memberUserId,
              invitedById: hostUserId,
              active: true,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
          }
          return null;
        },
      } as unknown as CloudInviteRepository;
    });

    async function buildFastifyApp() {
      const app = Fastify({ logger: false });
      registerHttpErrorHandler(app);
      await app.register(rateLimit, { global: false });
      await registerAuthRoutes(app, {
        accessSessionRepository: repository,
        cloudInviteRepository: mockInviteRepo,
      });
      await app.ready();
      return app;
    }

    it("successfully refreshes session and hits membership cache on second call", async () => {
      const app = await buildFastifyApp();
      const initial = await createAccessSession(repository, "guest-valid", "host-valid");

      // Invalida cualquier residuo en caché
      invalidateMembershipAuthCache("host-valid", "guest-valid");

      // Primera llamada: consulta mockInviteRepo.getMembership
      const res1 = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: initial.refreshToken },
      });

      expect(res1.statusCode).toBe(200);
      const data1 = res1.json();
      expect(data1.accessToken).toBeDefined();
      expect(data1.refreshToken).toBeDefined();
      expect(data1.userId).toBe("guest-valid");
      expect(getMembershipCalls).toBe(1);

      // Segunda llamada con el nuevo refresh token: debe usar la caché de membresía
      const res2 = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: data1.refreshToken },
      });

      expect(res2.statusCode).toBe(200);
      const data2 = res2.json();
      expect(data2.refreshToken).not.toBe(data1.refreshToken);
      // El contador de llamadas a DynamoDB/getMembership debe seguir siendo 1 (acierto de caché)
      expect(getMembershipCalls).toBe(1);

      await app.close();
    });

    it("returns 401 UNAUTHENTICATED when refresh token is invalid or session revoked", async () => {
      const app = await buildFastifyApp();

      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: "scr1.11111111-1111-1111-1111-111111111111.0123456789012345678901234567890123456789" },
      });

      expect(res.statusCode).toBe(401);
      const err = res.json();
      expect(err.code).toBe("UNAUTHENTICATED");

      await app.close();
    });
  });
});
