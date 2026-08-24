export type CompatibilityLevel = "likely" | "uncertain" | "unlikely";

export type FactorStatus = "pass" | "fail" | "unknown";

export interface CompatibilityFactor {
  id: string;
  status: FactorStatus;
  summary: string;
}

export interface HostSpecs {
  totalMemoryMb: number;
  cpuLogicalCores: number;
  cpuBrand: string;
  osLabel: string;
  gpuName: string | null;
}

export interface ParsedRequirements {
  ramMb: number | null;
  storageGb: number | null;
  directx: number | null;
  /** Texto de la línea Gráficos/Graphics si se detectó. */
  gpuText: string | null;
}

export interface RunCompatibilityReport {
  overall: CompatibilityLevel;
  host: HostSpecs;
  minimum: ParsedRequirements;
  recommended: ParsedRequirements;
  factors: CompatibilityFactor[];
}
