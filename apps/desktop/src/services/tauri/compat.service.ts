import { invoke } from "@tauri-apps/api/core";
import type { RunCompatibilityReport } from "@app-types/runCompatibility";

export async function evaluateRunCompatibility(
  pcRequirementsMinimum: string | null,
  pcRequirementsRecommended: string | null
): Promise<RunCompatibilityReport> {
  return invoke<RunCompatibilityReport>("evaluate_run_compatibility", {
    pcRequirementsMinimum,
    pcRequirementsRecommended,
  });
}

export async function getHostSpecs(): Promise<RunCompatibilityReport["host"]> {
  return invoke<RunCompatibilityReport["host"]>("get_host_specs");
}
