import { sleep } from "k6";
import { permanentlyDeleteGame, type LoadTestRun } from "@/helpers";
import { apiKey, maxVUs, options, userIdForVu, userIds } from "@/config";
import { healthSetupCheck } from "@/scenarios/health";
import { readScenario } from "@/scenarios/read";
import { presignScenario } from "@/scenarios/presign";
import { writeCycleScenario } from "@/scenarios/write-cycle";

export { options };

/**
 * Valida credenciales y conectividad, y crea un espacio temporal para las escrituras.
 *
 * @returns Identificadores compartidos con los VU y la limpieza final.
 */
export function setup(): LoadTestRun {
  if (!apiKey) throw new Error("Configura SYNC_GAMES_API_KEY para ejecutar pruebas autenticadas.");
  if (userIds.length === 0) throw new Error("No se pudo preparar la población de identidades de prueba.");
  healthSetupCheck();

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
  const activeUserCount = Math.min(userIds.length, maxVUs);
  if (userIds.length < maxVUs) {
    console.warn(
      `La prueba usa ${maxVUs} VUs y ${userIds.length} identidades; algunas cuentas tendrán varios dispositivos virtuales.`
    );
  }
  console.log(`Población k6: ${maxVUs} dispositivos virtuales y ${activeUserCount} identidades activas.`);
  console.log(`Identidades activas: ${userIds[0]} … ${userIds[activeUserCount - 1]}`);
  console.log(`Espacio temporal k6: k6-${runId}-<VU>`);
  return { runId, maxVUs, userIds };
}

/**
 * Ejecuta navegación, solicitudes de URL presignada y ciclos de guardado temporal.
 *
 * @param run - Identificadores compartidos creados por setup.
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
  sleep(2 + Math.random() * 4);
}

/**
 * Limpia los prefijos temporales al terminar; cada ciclo también limpia en finally.
 *
 * @param run - Identificadores compartidos creados por setup.
 */
export function teardown(run: LoadTestRun): void {
  for (let vu = 1; vu <= run.maxVUs; vu += 1) {
    const userId = userIdForVu(vu);
    permanentlyDeleteGame(`k6-${run.runId}-${vu}`, "run-teardown-cleanup", userId);
  }
}
