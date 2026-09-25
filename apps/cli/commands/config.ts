import figures from "figures";
import type { CliDeps } from "@cli/container";

export function runConfig(deps: CliDeps): void {
  const { configPath } = deps.getConfigPathUseCase.execute();
  console.log(`\n${figures.bullet} Config:`, configPath, "\n");
}
