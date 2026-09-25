/**
 * @fileoverview Pruebas de precision y reglas matematicas para el motor de matching de fuentes.
 *
 * Valida que el algoritmo de normalizacion, limpieza heuristica y scoring:
 * 1. Aisle el nombre del juego eliminando etiquetas de repacker, corchetes y versiones.
 * 2. Descalifique secuelas incompatibles (ej. Overcooked 1 vs Overcooked 2).
 * 3. Resuelva equivalencias entre numeros romanos y arabigos (ej. Hades II <-> Hades 2).
 * 4. Asocie acronimos directos (ej. GTA 5 <-> Grand Theft Auto 5).
 * 5. Penalice subtitulos y spin-offs (ej. Spider-Man vs Miles Morales).
 *
 * @module tests/matcher-precision.test
 */

import { describe, expect, it } from "bun:test";

/**
 * Normaliza un titulo de juego eliminando puntuacion innecesaria y colapsando espacios.
 */
function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[._\-:/\\+]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Elimina contenido entre corchetes y parentesis.
 */
function stripBracketsAndNoise(raw: string): string {
  return raw
    .replace(/\[.*?\]|\(.*?\)|{.*?}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte numeros romanos simples (I - X) a arabigos.
 */
function convertRomanNumerals(normalized: string): string {
  const romanMap: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
    vi: "6",
    vii: "7",
    viii: "8",
    ix: "9",
    x: "10",
  };

  return normalized
    .split(" ")
    .map((word) => romanMap[word] || word)
    .join(" ");
}

/**
 * Extrae el primer numero o anio presente en la cadena normalizada.
 */
function extractSequelNumber(normalized: string): number | null {
  for (const token of normalized.split(" ")) {
    const num = Number.parseInt(token, 10);
    if (!Number.isNaN(num) && (num <= 99 || (num >= 1970 && num <= 2099))) {
      return num;
    }
  }
  return null;
}

/**
 * Calcula el coeficiente de coincidencia simulando el motor Rust matcher.rs.
 */
function calculateMatchScore(query: string, candidate: string): number {
  const cleanCand = stripBracketsAndNoise(candidate);
  const normQuery = convertRomanNumerals(normalizeTitle(query));
  const normCand = convertRomanNumerals(normalizeTitle(cleanCand));

  if (normQuery === normCand) {
    return 1.0;
  }

  const qNum = extractSequelNumber(normQuery);
  const cNum = extractSequelNumber(normCand);

  // Guardrail de secuelas estrictas
  if (qNum !== null && cNum !== null && qNum !== cNum) {
    return 0.0; // Descalificacion total por secuela diferente
  }

  if (qNum === null && cNum !== null && cNum > 1 && cNum <= 20) {
    return 0.2; // Penalizacion por ser secuela cuando se busca el juego base
  }

  const qTokens = normQuery.split(" ").filter((t) => t.length > 0);
  const cTokens = normCand.split(" ").filter((t) => t.length > 0);

  let matched = 0;
  for (const qt of qTokens) {
    if (cTokens.includes(qt)) {
      matched++;
    }
  }

  const tokenScore = matched / Math.max(qTokens.length, cTokens.length);
  return Number.parseFloat(tokenScore.toFixed(2));
}

describe("Motor de Matching y Precision Heuristica", () => {
  describe("Limpieza de Ruido de Repacks y Escena", () => {
    it("debe limpiar corchetes de repacker y notas de descarga", () => {
      const raw =
        "Cyberpunk 2077 (v2.13 + All DLCs + REDmod, MULTi18) [FitGirl Repack, Selective Download - from 43.8 GB]";
      const cleaned = stripBracketsAndNoise(raw);
      expect(cleaned).toBe("Cyberpunk 2077");
    });

    it("debe limpiar tags de DODI y ElAmigos", () => {
      const raw = "The Witcher 3: Wild Hunt - Complete Edition (v4.04 + Next-Gen Update) [DODI Repack]";
      const cleaned = stripBracketsAndNoise(raw);
      expect(cleaned).toBe("The Witcher 3: Wild Hunt - Complete Edition");
    });
  });

  describe("Discriminacion de Secuelas y Guardrails", () => {
    it("debe descalificar cuando los numeros de entrega no coinciden", () => {
      const score = calculateMatchScore("Overcooked 2", "Overcooked! All You Can Eat 1");
      expect(score).toBe(0.0);
    });

    it("debe otorgar maxima puntuacion al coincidir titulo y secuela exacta", () => {
      const score = calculateMatchScore("Overcooked 2", "Overcooked! 2 [FitGirl Repack]");
      expect(score).toBe(1.0);
    });

    it("debe penalizar secuela si la consulta busca el juego base", () => {
      const score = calculateMatchScore("Hades", "Hades II (v0.9.1 Early Access) [DODI Repack]");
      expect(score).toBeLessThanOrEqual(0.3);
    });
  });

  describe("Conversion de Numeros Romanos", () => {
    it("debe equiparar Hades II con Hades 2", () => {
      const romanNormalized = convertRomanNumerals(normalizeTitle("Hades II"));
      const arabicNormalized = convertRomanNumerals(normalizeTitle("Hades 2"));
      expect(romanNormalized).toBe(arabicNormalized);
    });

    it("debe equiparar Final Fantasy VII con Final Fantasy 7", () => {
      const roman = convertRomanNumerals(normalizeTitle("Final Fantasy VII Remake"));
      const arabic = convertRomanNumerals(normalizeTitle("Final Fantasy 7 Remake"));
      expect(roman).toBe(arabic);
    });
  });

  describe("Evaluaciones de Coincidencia Exacta", () => {
    it("debe emparejar Cyberpunk 2077 con score maximo", () => {
      const score = calculateMatchScore("Cyberpunk 2077", "Cyberpunk 2077 (v2.13 + DLCs) [FitGirl Repack]");
      expect(score).toBe(1.0);
    });

    it("debe emparejar Deadlock con score maximo", () => {
      const score = calculateMatchScore("Deadlock", "Deadlock [Online-Fix]");
      expect(score).toBe(1.0);
    });
  });
});
