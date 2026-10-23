import { sleep } from "k6";
import { permanentlyDeleteGame, type LoadTestRun } from "@/helpers";
import { apiKey, maxVUs, options, userId } from "@/config";
import { healthSetupCheck } from "@/scenarios/health";
import { readScenario } from "@/scenarios/read";
import { presignScenario } from "@/scenarios/presign";
import { writeCycleScenario } from "@/scenarios/write-cycle";

export { options };

/**
 * Validates credentials and reachability before load, then creates a unique
 * namespace for temporary objects produced by the write scenario.
 *
 * @returns Run identifiers shared with VUs and teardown.
 */
export function setup(): LoadTestRun {
  if (!apiKey) throw new Error("Set API_KEY to run authenticated load scenarios.");
  if (!userId) throw new Error("Set USER_ID to a dedicated test user identifier.");
  healthSetupCheck();

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
  console.log(`k6 temporary data namespace: k6-${runId}-<VU>`);
  return { runId, maxVUs };
}

/**
 * Runs a weighted library workload: 70% reads, 20% upload URL generation, and
 * 10% complete temporary save upload cycles. A short think time caps request
 * rates at a predictable level per virtual user.
 *
 * @param run - Shared identifiers created by setup.
 */
export default function (run: LoadTestRun): void {
  const workload = Math.random();
  if (workload < 0.7) {
    readScenario();
  } else if (workload < 0.9) {
    presignScenario();
  } else {
    writeCycleScenario(run);
  }
  sleep(1);
}

/**
 * Removes each VU's temporary game prefix after the profile finishes. The
 * write scenario also cleans up in a finally block after every iteration.
 *
 * @param run - Shared identifiers created by setup.
 */
export function teardown(run: LoadTestRun): void {
  for (let vu = 1; vu <= run.maxVUs; vu += 1) {
    permanentlyDeleteGame(`k6-${run.runId}-${vu}`, "run-teardown-cleanup");
  }
}
