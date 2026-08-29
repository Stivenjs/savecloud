/**
 * @fileoverview Suite de pruebas de integración y seguridad para la API de SaveCloud con Bun.
 *
 * Todas las credenciales y URLs se configuran dinámicamente mediante variables de entorno
 * para evitar exposición de claves reales en el repositorio.
 *
 * Variables de entorno soportadas:
 * - `API_BASE_URL`: URL base de la API HTTP (Default: "http://localhost:3000")
 * - `SYNC_GAMES_API_KEY`: API Key para peticiones autenticadas
 * - `TEST_USER_ID`: Identificador de usuario para pruebas (Default: "test-user")
 * - `TEST_GAME_ID`: Identificador de juego para pruebas (Default: "test-game")
 *
 * @module tests/api-security-and-share.test
 */

import { describe, expect, test } from "bun:test";

/**
 * Configuración del entorno de pruebas.
 */
interface TestEnvironmentConfig {
  /** URL base de la API HTTP */
  readonly apiBaseUrl: string;
  /** API Key válida para autenticación */
  readonly apiKey: string;
  /** Identificador de usuario de prueba */
  readonly testUserId: string;
  /** Identificador del juego de prueba */
  readonly testGameId: string;
}

/**
 * Carga y valida la configuración requerida desde las variables de entorno.
 *
 * @returns {TestEnvironmentConfig} Configuración inicializada sin valores sensibles hardcodeados.
 */
function loadTestConfig(): TestEnvironmentConfig {
  const apiBaseUrl = (
    process.env.API_BASE_URL ||
    process.env.SYNC_GAMES_API_URL ||
    process.env.API_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  const apiKey = process.env.SYNC_GAMES_API_KEY || process.env.API_KEY || "";

  const testUserId = process.env.TEST_USER_ID || process.env.USER_ID || "xooty";
  const testGameId = process.env.TEST_GAME_ID || process.env.GAME_ID || "resident-evil-4-rune";

  return { apiBaseUrl, apiKey, testUserId, testGameId };
}

const config = loadTestConfig();

/**
 * Estructura de un archivo devuelto al resolver un token de compartición.
 */
interface ResolvedShareFile {
  /** Nombre relativo del archivo o ruta interna del backup */
  filename: string;
  /** Tamaño del archivo en bytes si está disponible */
  size?: number;
  /** Clave de objeto en S3 */
  key?: string;
}

/**
 * Respuesta JSON esperada del endpoint público GET /share/:token.
 */
interface ResolvedShareResponse {
  /** Identificador del propietario original del guardado */
  userId: string;
  /** Identificador del juego compartido */
  gameId: string;
  /** Fecha de expiración del enlace en formato ISO */
  expiresAt: string;
  /** Lista de archivos asociados al juego compartido */
  files?: ResolvedShareFile[];
  /** Indica si los datos corresponden a un backup empaquetado (.tar) */
  isPackaged?: boolean;
}

/**
 * Respuesta JSON esperada al crear un enlace compartido POST /share.
 */
interface CreateShareResponse {
  /** Token hexadecimal generado */
  token: string;
  /** URL pública completa para compartir */
  shareUrl: string;
  /** Fecha de expiración del enlace en formato ISO */
  expiresAt: string;
}

describe("Suite de Seguridad y Autorizacion de la API", () => {
  test("Debe rechazar peticiones no autenticadas a rutas protegidas con codigo 401", async () => {
    const endpoints = [
      `${config.apiBaseUrl}/saves`,
      `${config.apiBaseUrl}/notifications`,
      `${config.apiBaseUrl}/clips`,
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, { method: "GET" });
      expect(response.status).toBe(401);
    }
  });

  test("Debe rechazar peticiones con API Key invalida con codigo 401 o 403", async () => {
    const response = await fetch(`${config.apiBaseUrl}/saves`, {
      method: "GET",
      headers: {
        "x-api-key": "invalid_test_key_dummy",
        "x-user-id": config.testUserId,
      },
    });

    expect([401, 403]).toContain(response.status);
  });

  test("Debe permitir el acceso a rutas protegidas cuando se proporciona una API Key valida", async () => {
    if (!config.apiKey) {
      console.warn("[WARN] SYNC_GAMES_API_KEY no configurada. Omitiendo prueba de autenticacion valida.");
      return;
    }

    const headers = {
      "x-api-key": config.apiKey,
      "x-user-id": config.testUserId,
    };

    const savesRes = await fetch(`${config.apiBaseUrl}/saves`, { headers });
    expect(savesRes.status).toBe(200);

    const notifsRes = await fetch(`${config.apiBaseUrl}/notifications`, { headers });
    expect(notifsRes.status).toBe(200);

    const clipsRes = await fetch(`${config.apiBaseUrl}/clips`, { headers });
    expect(clipsRes.status).toBe(200);
  });

  test("Debe permitir el acceso a endpoints publicos sin cabeceras de autorizacion", async () => {
    const healthRes = await fetch(`${config.apiBaseUrl}/health`);
    expect(healthRes.status).toBe(200);
  });
});

describe("Suite de Enlaces Compartidos y Juegos Empaquetados", () => {
  let createdToken = "";

  test("POST /share debe generar un token de comparticion valido con expiracion futura", async () => {
    if (!config.apiKey) {
      console.warn("[WARN] SYNC_GAMES_API_KEY no configurada. Omitiendo creacion de share token.");
      return;
    }

    const response = await fetch(`${config.apiBaseUrl}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "x-user-id": config.testUserId,
      },
      body: JSON.stringify({
        gameId: config.testGameId,
        expiresInDays: 7,
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateShareResponse;

    expect(body.token).toBeString();
    expect(body.token.length).toBeGreaterThanOrEqual(16);
    expect(body.shareUrl).toContain(`/share/${body.token}`);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    createdToken = body.token;
  });

  test("GET /share/:token debe resolver publicamente el juego compartido con su lista de archivos", async () => {
    if (!createdToken) {
      return;
    }

    // Peticion publica (sin cabecera x-api-key)
    const response = await fetch(`${config.apiBaseUrl}/share/${createdToken}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as ResolvedShareResponse;

    expect(body.userId).toBe(config.testUserId);
    expect(body.gameId).toBe(config.testGameId);
    expect(body.files).toBeArray();

    // Si existen archivos empaquetados (.tar o backups/), validar flag isPackaged
    if (body.files && body.files.length > 0) {
      const hasTarOrBackup = body.files.some((f) => f.filename.endsWith(".tar") || f.filename.startsWith("backups/"));

      if (hasTarOrBackup) {
        expect(body.isPackaged).toBe(true);
      }
    }
  });

  test("GET /share/:token debe responder 404 para tokens inexistentes", async () => {
    const invalidToken = "000000000000000000000000000000000000000000000000";
    const response = await fetch(`${config.apiBaseUrl}/share/${invalidToken}`);
    expect(response.status).toBe(404);
  });
});
