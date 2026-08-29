/**
 * @fileoverview Ejecutor CLI de pruebas de integración y seguridad para la API de SaveCloud con Bun.
 *
 * Todas las credenciales, claves y endpoints se cargan exclusivamente desde variables de entorno.
 *
 * Variables de entorno requeridas / soportadas:
 * - `API_BASE_URL`: URL base de la API HTTP (Default: "http://localhost:3000")
 * - `SYNC_GAMES_API_KEY`: API Key para peticiones autenticadas (Requerida para pruebas completas)
 * - `TEST_USER_ID`: Identificador de usuario de prueba (Default: "test-user")
 * - `TEST_GAME_ID`: Identificador de juego de prueba (Default: "test-game")
 *
 * @example
 * ```bash
 * API_BASE_URL="https://api.tu-dominio.com" SYNC_GAMES_API_KEY="tu_key" bun run tests/run-api-tests.ts
 * ```
 */

import { performance } from "node:perf_hooks";

/**
 * Configuración inmutable del entorno de pruebas.
 */
interface ApiTestConfig {
  /** URL base de la API */
  readonly apiBaseUrl: string;
  /** Clave de autenticación */
  readonly apiKey: string;
  /** Identificador de usuario de prueba */
  readonly testUserId: string;
  /** Identificador de juego de prueba */
  readonly testGameId: string;
}

/**
 * Representa el resultado individual de una prueba ejecutada.
 */
interface TestCaseResult {
  /** Nombre descriptivo de la prueba */
  readonly name: string;
  /** Estado de éxito o fracaso */
  readonly passed: boolean;
  /** Código de estado HTTP obtenido */
  readonly status: number;
  /** Tiempo de ejecución en milisegundos */
  readonly durationMs: number;
  /** Detalle o mensaje de error si falló */
  readonly detail?: string;
}

/**
 * Carga las variables de entorno para la ejecución del test runner.
 *
 * @returns {ApiTestConfig} Objeto inmutable con la configuración de la prueba.
 */
function getApiTestConfig(): ApiTestConfig {
  return {
    apiBaseUrl: (
      process.env.API_BASE_URL ||
      process.env.SYNC_GAMES_API_URL ||
      process.env.API_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, ""),
    apiKey: process.env.SYNC_GAMES_API_KEY || process.env.API_KEY || "",
    testUserId: process.env.TEST_USER_ID || process.env.USER_ID || "xooty",
    testGameId: process.env.TEST_GAME_ID || process.env.GAME_ID || "resident-evil-4-rune",
  };
}

/**
 * Ejecuta una petición HTTP cronometrada y evalúa el código de estado devuelto.
 *
 * @param name - Nombre de la prueba.
 * @param fetchFn - Función que retorna la promesa de la petición Fetch.
 * @param expectedStatuses - Código o códigos de estado HTTP válidos.
 * @returns {Promise<TestCaseResult>} Resultado de la prueba.
 */
async function executeCheck(
  name: string,
  fetchFn: () => Promise<Response>,
  expectedStatuses: number | number[]
): Promise<TestCaseResult> {
  const allowed = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  const start = performance.now();

  try {
    const res = await fetchFn();
    const durationMs = Math.round((performance.now() - start) * 10) / 10;
    const passed = allowed.includes(res.status);

    return {
      name,
      passed,
      status: res.status,
      durationMs,
      detail: passed ? undefined : `Esperaba HTTP ${allowed.join(" o ")}, pero recibió ${res.status}`,
    };
  } catch (error) {
    const durationMs = Math.round((performance.now() - start) * 10) / 10;
    return {
      name,
      passed: false,
      status: 0,
      durationMs,
      detail: error instanceof Error ? error.message : "Error desconocido de red",
    };
  }
}

/**
 * Función principal que orquesta la ejecución de la suite de pruebas.
 */
async function run(): Promise<void> {
  const cfg = getApiTestConfig();
  const results: TestCaseResult[] = [];

  console.log("\n" + "=".repeat(70));
  console.log("SAVECLOUD API TEST RUNNER (BUN)");
  console.log(`Base URL : ${cfg.apiBaseUrl}`);
  console.log(`Usuario  : ${cfg.testUserId}`);
  console.log(`Juego    : ${cfg.testGameId}`);
  console.log(
    `API Key  : ${cfg.apiKey ? "****** (Configurada)" : "[WARN] No configurada (Omitiendo pruebas autenticadas)"}`
  );
  console.log("=".repeat(70) + "\n");

  console.log("[1/2] Verificando Politicas de Seguridad y Autorizacion...");

  results.push(
    await executeCheck("GET /saves (Sin API Key)", () => fetch(`${cfg.apiBaseUrl}/saves`), 401),
    await executeCheck("GET /notifications (Sin API Key)", () => fetch(`${cfg.apiBaseUrl}/notifications`), 401),
    await executeCheck("GET /clips (Sin API Key)", () => fetch(`${cfg.apiBaseUrl}/clips`), 401),
    await executeCheck(
      "GET /saves (API Key Invalida)",
      () =>
        fetch(`${cfg.apiBaseUrl}/saves`, {
          headers: { "x-api-key": "invalid_key_dummy", "x-user-id": cfg.testUserId },
        }),
      [401, 403]
    ),
    await executeCheck("GET /health (Endpoint Publico)", () => fetch(`${cfg.apiBaseUrl}/health`), 200)
  );

  if (cfg.apiKey) {
    results.push(
      await executeCheck(
        "GET /saves (API Key Legitima)",
        () =>
          fetch(`${cfg.apiBaseUrl}/saves`, {
            headers: { "x-api-key": cfg.apiKey, "x-user-id": cfg.testUserId },
          }),
        200
      ),
      await executeCheck(
        "GET /clips (API Key Legitima)",
        () =>
          fetch(`${cfg.apiBaseUrl}/clips`, {
            headers: { "x-api-key": cfg.apiKey, "x-user-id": cfg.testUserId },
          }),
        200
      ),
      await executeCheck(
        "GET /notifications (API Key Legitima)",
        () =>
          fetch(`${cfg.apiBaseUrl}/notifications`, {
            headers: { "x-api-key": cfg.apiKey, "x-user-id": cfg.testUserId },
          }),
        200
      )
    );
  }

  console.log("\n[2/2] Verificando Enlaces Compartidos y Juegos Empaquetados...");

  // 1. Crear enlace compartido si tenemos API Key
  let generatedToken = "";
  if (cfg.apiKey) {
    const startShare = performance.now();
    try {
      const createRes = await fetch(`${cfg.apiBaseUrl}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "x-user-id": cfg.testUserId,
        },
        body: JSON.stringify({
          gameId: cfg.testGameId,
          expiresInDays: 7,
        }),
      });
      const shareDuration = Math.round((performance.now() - startShare) * 10) / 10;

      if (createRes.status === 201) {
        const data = (await createRes.json()) as { token: string };
        generatedToken = data.token;
        results.push({
          name: "POST /share (Crear Token de Partida)",
          passed: true,
          status: 201,
          durationMs: shareDuration,
        });
      } else {
        results.push({
          name: "POST /share (Crear Token de Partida)",
          passed: false,
          status: createRes.status,
          durationMs: shareDuration,
          detail: await createRes.text(),
        });
      }
    } catch (err) {
      results.push({
        name: "POST /share (Crear Token de Partida)",
        passed: false,
        status: 0,
        durationMs: 0,
        detail: err instanceof Error ? err.message : "Error al conectar",
      });
    }
  }

  // 2. Resolver enlace publico
  if (generatedToken) {
    const startResolve = performance.now();
    try {
      const resolveRes = await fetch(`${cfg.apiBaseUrl}/share/${generatedToken}`);
      const resolveDuration = Math.round((performance.now() - startResolve) * 10) / 10;

      if (resolveRes.status === 200) {
        const body = (await resolveRes.json()) as {
          files?: { filename: string }[];
          isPackaged?: boolean;
        };

        const hasFiles = Array.isArray(body.files) && body.files.length > 0;
        results.push({
          name: "GET /share/:token (Resolucion Publica de Archivos Empaquetados)",
          passed: hasFiles,
          status: 200,
          durationMs: resolveDuration,
          detail: hasFiles ? undefined : "No se encontraron archivos asociados al juego compartido",
        });
      } else {
        results.push({
          name: "GET /share/:token (Resolucion Publica de Archivos Empaquetados)",
          passed: false,
          status: resolveRes.status,
          durationMs: resolveDuration,
        });
      }
    } catch (err) {
      results.push({
        name: "GET /share/:token (Resolucion Publica de Archivos Empaquetados)",
        passed: false,
        status: 0,
        durationMs: 0,
        detail: err instanceof Error ? err.message : "Fallo de red",
      });
    }
  } else {
    // Probar token invalido publico
    results.push(
      await executeCheck(
        "GET /share/000000000000000000000000 (Token Inexistente Publico)",
        () => fetch(`${cfg.apiBaseUrl}/share/000000000000000000000000000000000000000000000000`),
        404
      )
    );
  }

  // Impresion del Reporte
  console.log("\n" + "=".repeat(70));
  console.log("REPORTE DE RESULTADOS");
  console.log("=".repeat(70));

  let passedCount = 0;
  for (const r of results) {
    const tag = r.passed ? "[PASS]" : "[FAIL]";
    const statusText = `HTTP ${r.status}`.padEnd(9);
    const timeText = `${r.durationMs}ms`.padStart(8);
    console.log(`${tag} [${statusText}] ${timeText} - ${r.name}`);
    if (r.detail) {
      console.log(`   └─ [WARN] ${r.detail}`);
    }
    if (r.passed) passedCount++;
  }

  console.log("=".repeat(70));
  const successRate = Math.round((passedCount / results.length) * 100);
  console.log(`Resultado: ${passedCount}/${results.length} pruebas superadas (${successRate}% éxito)`);

  if (passedCount < results.length) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Error fatal en el ejecutor de pruebas:", err);
  process.exit(1);
});
