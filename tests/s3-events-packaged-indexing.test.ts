import { describe, expect, it } from "bun:test";
import { isIgnoredS3Key, ProcessS3EventUseCase } from "@application/use-cases/ProcessS3EventUseCase";
import { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";
import type { SaveRepository, BackupMetadata } from "@domain/ports/SaveRepository";

describe("S3 Key Filtering - Juegos Empaquetados vs Archivos de Sistema", () => {
  it("debe permitir y NO ignorar backups empaquetados (.tar) bajo userId/gameId/backups/", () => {
    const key = "usr_test_1/elden_ring/backups/2026-09-17_19-00-00.tar";
    const parts = key.split("/");
    expect(isIgnoredS3Key(key, parts)).toBe(false);
  });

  it("debe permitir y NO ignorar archivos normales de guardado", () => {
    const key = "usr_test_1/elden_ring/ER0000.sl2";
    const parts = key.split("/");
    expect(isIgnoredS3Key(key, parts)).toBe(false);
  });

  it("debe permitir rutas legítimas de guardados aunque contengan carpetas comunes como assets o public", () => {
    const key = "usr_test_1/custom_game/saves/public/assets/slot1.sav";
    const parts = key.split("/");
    expect(isIgnoredS3Key(key, parts)).toBe(false);
  });

  it("debe ignorar marcadores de directorio vacíos generados por S3 o MinIO", () => {
    const dirKey = "usr_test_1/elden_ring/backups/";
    const parts = dirKey.split("/");
    expect(isIgnoredS3Key(dirKey, parts)).toBe(true);

    const gameDirKey = "usr_test_1/elden_ring/";
    expect(isIgnoredS3Key(gameDirKey, gameDirKey.split("/"))).toBe(true);
  });

  it("debe ignorar prefijos de sistema a nivel raíz del bucket (trash, share-tokens, clips, etc.)", () => {
    const trashKey = "trash/usr_test_1/elden_ring/backups/2026-09-17.tar";
    expect(isIgnoredS3Key(trashKey, trashKey.split("/"))).toBe(true);

    const tokenKey = "share-tokens/abc-xyz-123.json";
    expect(isIgnoredS3Key(tokenKey, tokenKey.split("/"))).toBe(true);

    const clipKey = "clips/usr_test_1/elden_ring/highlight.mp4";
    expect(isIgnoredS3Key(clipKey, clipKey.split("/"))).toBe(true);

    const rootBackup = "backups/legacy-server-backup.tar";
    expect(isIgnoredS3Key(rootBackup, rootBackup.split("/"))).toBe(true);
  });

  it("debe ignorar metadatos internos del juego como __torrent__ y __config__", () => {
    const torrentKey = "usr_test_1/elden_ring/__torrent__/state.resume";
    expect(isIgnoredS3Key(torrentKey, torrentKey.split("/"))).toBe(true);

    const configKey = "usr_test_1/elden_ring/__config__/settings.json";
    expect(isIgnoredS3Key(configKey, configKey.split("/"))).toBe(true);
  });
});

describe("ProcessS3EventUseCase - Indexación de Juegos Empaquetados en DynamoDB", () => {
  it("debe indexar en SaveFilesIndexTable y aplicar delta en GameStatsTable al recibir Object Created de un empaquetado", async () => {
    const upsertedItems: any[] = [];
    const appliedDeltas: any[] = [];

    const mockSaveFileIndexRepo: SaveFileIndexRepository = {
      listByUser: async () => [],
      listByUserAndGame: async () => [],
      getByObjectKey: async () => null,
      upsert: async (item) => {
        upsertedItems.push(item);
      },
      delete: async () => {},
    };

    const mockGameStatRepo: GameStatRepository = {
      listByUser: async () => [],
      save: async () => {},
      delete: async () => {},
      applyDelta: async (delta) => {
        appliedDeltas.push(delta);
      },
    };

    const useCase = new ProcessS3EventUseCase(mockSaveFileIndexRepo, mockGameStatRepo);
    const eventTime = new Date("2026-09-17T20:00:00.000Z");

    await useCase.execute({
      detailType: "Object Created",
      s3Key: "usr_alice/sekiro/backups/2026-09-17_full.tar",
      size: 15_000_000,
      eventTime,
    });

    // 1. Debe haberse indexado el archivo empaquetado
    expect(upsertedItems).toHaveLength(1);
    expect(upsertedItems[0]).toEqual({
      userId: "usr_alice",
      gameId: "sekiro",
      objectKey: "usr_alice/sekiro/backups/2026-09-17_full.tar",
      size: 15_000_000,
      lastModified: eventTime,
    });

    // 2. Debe haberse aplicado el delta al GameStat del juego
    expect(appliedDeltas).toHaveLength(1);
    expect(appliedDeltas[0]).toEqual({
      userId: "usr_alice",
      gameId: "sekiro",
      deltaFileCount: 1,
      deltaSizeBytes: 15_000_000,
      lastModified: eventTime,
    });
  });

  it("debe desindexar en SaveFilesIndexTable y restar métricas en GameStatsTable al recibir Object Deleted de un empaquetado", async () => {
    const deletedKeys: { userId: string; objectKey: string }[] = [];
    const appliedDeltas: any[] = [];

    const mockSaveFileIndexRepo: SaveFileIndexRepository = {
      listByUser: async () => [],
      listByUserAndGame: async () => [],
      getByObjectKey: async (userId, objectKey) => {
        if (objectKey === "usr_alice/sekiro/backups/2026-09-17_full.tar") {
          return {
            gameId: "sekiro",
            key: objectKey,
            filename: "backups/2026-09-17_full.tar",
            size: 15_000_000,
            lastModified: new Date("2026-09-17T20:00:00.000Z"),
          };
        }
        return null;
      },
      upsert: async () => {},
      delete: async (userId, objectKey) => {
        deletedKeys.push({ userId, objectKey });
      },
    };

    const mockGameStatRepo: GameStatRepository = {
      listByUser: async () => [],
      save: async () => {},
      delete: async () => {},
      applyDelta: async (delta) => {
        appliedDeltas.push(delta);
      },
    };

    const useCase = new ProcessS3EventUseCase(mockSaveFileIndexRepo, mockGameStatRepo);

    await useCase.execute({
      detailType: "Object Deleted",
      s3Key: "usr_alice/sekiro/backups/2026-09-17_full.tar",
    });

    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toEqual({
      userId: "usr_alice",
      objectKey: "usr_alice/sekiro/backups/2026-09-17_full.tar",
    });

    expect(appliedDeltas).toHaveLength(1);
    expect(appliedDeltas[0]).toEqual({
      userId: "usr_alice",
      gameId: "sekiro",
      deltaFileCount: -1,
      deltaSizeBytes: -15_000_000,
      lastModified: null,
    });
  });
});

describe("ListBackupsUseCase - Consulta de Backups Empaquetados", () => {
  it("debe retornar los backups desde DynamoDB si se encuentran en el índice de archivos", async () => {
    let s3Called = false;

    const mockSaveRepository = {
      listBackups: async () => {
        s3Called = true;
        return [];
      },
    } as unknown as SaveRepository;

    const mockSaveFileIndexRepo: SaveFileIndexRepository = {
      listByUser: async () => [],
      listByUserAndGame: async (userId, gameId) => [
        {
          gameId: "hollow_knight",
          key: "usr_bob/hollow_knight/backups/2026-09-10.tar",
          filename: "backups/2026-09-10.tar",
          size: 2_048_000,
          lastModified: new Date("2026-09-10T12:00:00.000Z"),
        },
      ],
      getByObjectKey: async () => null,
      upsert: async () => {},
      delete: async () => {},
    };

    const useCase = new ListBackupsUseCase(mockSaveRepository, mockSaveFileIndexRepo);
    const result = await useCase.execute({ userId: "usr_bob", gameId: "hollow_knight" });

    expect(result.backups).toHaveLength(1);
    expect(result.backups[0].filename).toBe("2026-09-10.tar");
    expect(result.backups[0].key).toBe("usr_bob/hollow_knight/backups/2026-09-10.tar");
    expect(result.backups[0].size).toBe(2_048_000);
    // No debe haber tenido que llamar a S3
    expect(s3Called).toBe(false);
  });

  it("debe hacer fallback a S3 si DynamoDB no tiene backups indexados", async () => {
    let s3Called = false;

    const mockSaveRepository = {
      listBackups: async (userId: string, gameId: string): Promise<BackupMetadata[]> => {
        s3Called = true;
        return [
          {
            key: `${userId}/${gameId}/backups/s3-backup.tar`,
            filename: "s3-backup.tar",
            lastModified: new Date("2026-09-01"),
            size: 1_000_000,
          },
        ];
      },
    } as unknown as SaveRepository;

    const mockSaveFileIndexRepo: SaveFileIndexRepository = {
      listByUser: async () => [],
      listByUserAndGame: async () => [],
      getByObjectKey: async () => null,
      upsert: async () => {},
      delete: async () => {},
    };

    const useCase = new ListBackupsUseCase(mockSaveRepository, mockSaveFileIndexRepo);
    const result = await useCase.execute({ userId: "usr_bob", gameId: "hollow_knight" });

    expect(s3Called).toBe(true);
    expect(result.backups).toHaveLength(1);
    expect(result.backups[0].filename).toBe("s3-backup.tar");
  });
});
