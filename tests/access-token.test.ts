import { describe, it, expect, beforeEach } from "bun:test";
import {
  issueUserAccessToken,
  verifyUserAccessToken,
  verifyLegacyUserAccessToken,
  clearAccessTokenVerificationCache,
  TOKEN_V2_PREFIX,
  TOKEN_V1_PREFIX,
} from "@shared/accessToken";

describe("AccessToken Service & Security Suite", () => {
  const TEST_SECRET = "super-secret-key-32-bytes-minimum-abc123!!";
  const TEST_API_KEY = "master-api-key-test-value-12345";

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = TEST_SECRET;
    process.env.API_KEY = TEST_API_KEY;
    clearAccessTokenVerificationCache();
  });

  describe("issueUserAccessToken", () => {
    it("issues a valid sc2 token with correct format", () => {
      const token = issueUserAccessToken("user-1", "sess-1", "host-1", 600);

      expect(token.startsWith(TOKEN_V2_PREFIX)).toBe(true);
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("sc2");
      expect(parts[2]).toHaveLength(43); // Longitud exacta de un HMAC-SHA256 en base64url

      const verified = verifyUserAccessToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe("user-1");
      expect(verified?.sessionId).toBe("sess-1");
      expect(verified?.hostUserId).toBe("host-1");
      expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("throws when ACCESS_TOKEN_SECRET is missing", () => {
      delete process.env.ACCESS_TOKEN_SECRET;
      expect(() => issueUserAccessToken("u", "s", "h")).toThrow("ACCESS_TOKEN_SECRET is not configured");
    });

    it("throws when arguments are empty or invalid", () => {
      expect(() => issueUserAccessToken("", "s", "h")).toThrow("userId must not be empty");
      expect(() => issueUserAccessToken("u", "   ", "h")).toThrow("sessionId and hostUserId must not be empty");
      expect(() => issueUserAccessToken("u", "s", "")).toThrow("sessionId and hostUserId must not be empty");
      expect(() => issueUserAccessToken("u", "s", "h", -5)).toThrow("ttlSeconds must be a finite number > 0");
      expect(() => issueUserAccessToken("u", "s", "h", NaN)).toThrow("ttlSeconds must be a finite number > 0");
    });
  });

  describe("verifyUserAccessToken", () => {
    it("verifies and freezes token claims correctly", () => {
      const token = issueUserAccessToken("alice", "session-xyz", "bob", 300);
      const verified = verifyUserAccessToken(token);

      expect(verified).not.toBeNull();
      expect(Object.isFrozen(verified)).toBe(true);
      expect(verified?.userId).toBe("alice");
      expect(verified?.sessionId).toBe("session-xyz");
      expect(verified?.hostUserId).toBe("bob");
    });

    it("uses in-memory verification cache for repeat queries", () => {
      const token = issueUserAccessToken("charlie", "session-cached", "host-cached", 300);

      const first = verifyUserAccessToken(token);
      const second = verifyUserAccessToken(token);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      // Ambos deben apuntar al mismo objeto inmutable en caché
      expect(first).toBe(second);
    });

    it("fast-path: rejects non-string and malformed prefix immediately", () => {
      expect(verifyUserAccessToken(null as unknown as string)).toBeNull();
      expect(verifyUserAccessToken(undefined as unknown as string)).toBeNull();
      expect(verifyUserAccessToken("")).toBeNull();
      expect(verifyUserAccessToken("sc1.invalid-v2-token")).toBeNull();
      expect(verifyUserAccessToken("invalid-token-without-prefix")).toBeNull();
      expect(verifyUserAccessToken("sc2.short")).toBeNull();
    });

    it("rejects forged or tampered signatures (fast-path length & timing check)", () => {
      const token = issueUserAccessToken("david", "sess-1", "host-1", 300);
      const parts = token.split(".");

      // Firma con longitud incorrecta (descarte inmediato sin computar HMAC)
      const badLengthToken = `${parts[0]}.${parts[1]}.shortSig`;
      expect(verifyUserAccessToken(badLengthToken)).toBeNull();

      // Firma con longitud correcta (43 chars) pero manipulada
      const tamperedSig = "A".repeat(43);
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;
      expect(verifyUserAccessToken(tamperedToken)).toBeNull();

      // Carga alterada con firma original
      const fakePayload = Buffer.from(
        JSON.stringify({ v: 2, sub: "hacker", sid: "s", aud: "a", exp: Math.floor(Date.now() / 1000) + 300 })
      ).toString("base64url");
      const forgedToken = `${parts[0]}.${fakePayload}.${parts[2]}`;
      expect(verifyUserAccessToken(forgedToken)).toBeNull();
    });

    it("rejects expired tokens", () => {
      // Token emitido con expiración en el pasado
      const pastExp = Math.floor(Date.now() / 1000) - 10;
      const payload = { v: 2, sub: "user-old", sid: "sess-old", aud: "host-old", exp: pastExp };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = require("crypto").createHmac("sha256", TEST_SECRET).update(body).digest("base64url");
      const expiredToken = `sc2.${body}.${sig}`;

      expect(verifyUserAccessToken(expiredToken)).toBeNull();
    });
  });

  describe("verifyLegacyUserAccessToken", () => {
    it("verifies valid legacy sc1 token", () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = { v: 1, sub: "legacy-user", exp: now + 3600 };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = require("crypto").createHmac("sha256", TEST_API_KEY).update(body).digest("base64url");
      const legacyToken = `${TOKEN_V1_PREFIX}${body}.${sig}`;

      const verified = verifyLegacyUserAccessToken(legacyToken);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe("legacy-user");
      expect(verified?.exp).toBe(payload.exp);
    });

    it("rejects expired or tampered sc1 token", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const payload = { v: 1, sub: "expired-user", exp: pastExp };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = require("crypto").createHmac("sha256", TEST_API_KEY).update(body).digest("base64url");
      const expiredToken = `${TOKEN_V1_PREFIX}${body}.${sig}`;

      expect(verifyLegacyUserAccessToken(expiredToken)).toBeNull();

      const tampered = `${TOKEN_V1_PREFIX}${body}.${"B".repeat(43)}`;
      expect(verifyLegacyUserAccessToken(tampered)).toBeNull();
    });
  });
});
