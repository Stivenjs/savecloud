/**
 * Convierte un string de tamaño (ej. "133,71 GB", "500 MB") a bytes.
 */
export function parseSize(sizeStr: string | null | undefined): number {
  if (!sizeStr) return 0;

  // Normalizamos comas a puntos (formato español/europeo)
  const cleaned = sizeStr.replace(/,/g, ".");

  // Extraemos el valor numérico y la unidad
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };

  // Manejamos variaciones como GiB, MiB o simplemente G, M
  let lookupUnit = unit;
  if (unit.endsWith("IB")) lookupUnit = unit.replace("IB", "B");
  else if (unit.length === 1 && "KMG T".includes(unit)) lookupUnit = `${unit}B`;

  return value * (units[lookupUnit] || units[unit] || 1);
}
