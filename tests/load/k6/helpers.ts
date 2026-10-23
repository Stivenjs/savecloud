import http from "k6/http";
import type { RefinedResponse } from "k6/http";
import { apiKey, baseUrl, userIdForVu, assertStatus } from "@/config";

/**
 * Identidad de una ejecución compartida entre setup, VUs y teardown.
 */
export interface LoadTestRun {
  /** Prefijo único que separa esta ejecución de datos reales o anteriores. */
  runId: string;
  /** Máximo de VUs configurado para el perfil activo. */
  maxVUs: number;
  /** Identidades de prueba asignadas a la población virtual. */
  userIds: string[];
}

/**
 * Construye los encabezados usados por las rutas autenticadas de la API.
 *
 * @returns Encabezados API key y usuario de prueba.
 */
export function apiHeaders(userId = userIdForVu(__VU)): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "x-user-id": userId,
    "content-type": "application/json",
  };
}

/**
 * Convierte una respuesta JSON validada en un objeto.
 *
 * @param response - Respuesta HTTP que se espera contenga JSON.
 * @param label - Nombre de la operación para el mensaje de error.
 * @returns Objeto JSON decodificado.
 */
export function parseJson<T>(response: RefinedResponse<"text">, label: string): T {
  try {
    return JSON.parse(response.body as string) as T;
  } catch {
    throw new Error(`${label}: la API devolvió JSON inválido.`);
  }
}

/**
 * Elimina permanentemente los datos del juego aislado asignado a un VU.
 *
 * @param gameId - Identificador temporal reservado por el test.
 * @param label - Etiqueta k6 para agrupar la métrica de limpieza.
 */
export function permanentlyDeleteGame(gameId: string, label = "cleanup", userId?: string): void {
  const response = httpPost(`${baseUrl}/saves/delete-game`, { gameId, permanent: true }, label, userId);
  assertStatus(response, 204, label);
}

/**
 * Envía un POST JSON autenticado a la API con etiquetas de métricas.
 *
 * @param url - URL absoluta del endpoint.
 * @param body - Objeto que se serializará como JSON.
 * @param endpoint - Etiqueta de endpoint para los resultados de k6.
 * @returns Respuesta HTTP de k6.
 */
export function httpPost(
  url: string,
  body: unknown,
  endpoint: string,
  userId?: string
): RefinedResponse<"text"> {
  return http.post<"text">(url, JSON.stringify(body), { headers: apiHeaders(userId), tags: { endpoint } });
}
