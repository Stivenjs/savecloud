import { describe, it, expect } from "bun:test";
import { computeSavesEtag, computeSummaryEtag, send304IfNotModified } from "@shared/etag";

describe("ETag and 304 Performance Utilities", () => {
  it("generates deterministic weak ETag for empty saves", () => {
    const etag = computeSavesEtag([]);
    expect(etag).toBe('W/"0-0-0"');
  });

  it("generates stable ETag based on save count, size, and last modified", () => {
    const d1 = new Date(1700000000000);
    const d2 = new Date(1700000005000);

    const saves = [
      { key: "u1/game/s1.dat", lastModified: d1, size: 1024 },
      { key: "u1/game/s2.dat", lastModified: d2, size: 2048 },
    ];

    const etag = computeSavesEtag(saves);
    expect(etag).toBe('W/"2-3072-1700000005000"');
  });

  it("generates stable summary ETag", () => {
    const summary = [
      { gameId: "game-1", fileCount: 2, totalSizeBytes: 4096, lastModified: "2026-09-01T10:00:00.000Z" },
      { gameId: "game-2", fileCount: 3, totalSizeBytes: 8192, lastModified: "2026-09-02T12:00:00.000Z" },
    ];

    const etag = computeSummaryEtag(summary);
    expect(etag).toBe('W/"2-5-12288-2026-09-02T12:00:00.000Z"');
  });

  it("handles 304 response when if-none-match matches", () => {
    const etag = 'W/"1-100-12345"';
    let statusSent = 0;
    const headersSent: Record<string, string> = {};

    const mockRequest = {
      headers: { "if-none-match": etag },
    } as any;

    const mockReply = {
      header: (k: string, v: string) => {
        headersSent[k] = v;
        return mockReply;
      },
      status: (code: number) => {
        statusSent = code;
        return mockReply;
      },
      send: () => mockReply,
    } as any;

    const notModified = send304IfNotModified(mockRequest, mockReply, etag);
    expect(notModified).toBe(true);
    expect(statusSent).toBe(304);
    expect(headersSent["ETag"]).toBe(etag);
    expect(headersSent["Cache-Control"]).toBe("private, no-cache");
  });

  it("returns false and attaches headers when if-none-match does not match", () => {
    const etag = 'W/"1-100-12345"';
    let statusSent = 0;
    const headersSent: Record<string, string> = {};

    const mockRequest = {
      headers: { "if-none-match": 'W/"different"' },
    } as any;

    const mockReply = {
      header: (k: string, v: string) => {
        headersSent[k] = v;
        return mockReply;
      },
      status: (code: number) => {
        statusSent = code;
        return mockReply;
      },
      send: () => mockReply,
    } as any;

    const notModified = send304IfNotModified(mockRequest, mockReply, etag);
    expect(notModified).toBe(false);
    expect(statusSent).toBe(0);
    expect(headersSent["ETag"]).toBe(etag);
  });
});
