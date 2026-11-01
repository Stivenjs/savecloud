/** Trabajo recurrente que se ejecuta dentro de un worker de larga duración. */
export interface PeriodicTask {
  /** Nombre usado para identificar la tarea en los logs. */
  name: string;
  /** Tiempo entre ejecuciones, en milisegundos. */
  intervalMs: number;
  /** Acción asíncrona de una ejecución. */
  execute: () => Promise<void>;
  /** Permite personalizar el registro de errores sin detener el ciclo. */
  onError?: (error: unknown) => void;
}

/** Opciones para leer una duración desde la configuración del proceso. */
export interface IntervalOptions {
  /** Valor mínimo válido. */
  minimum: number;
  /** Nombre de una variable secundaria usada como fallback opcional. */
  fallbackName?: string;
  /** Exige que el valor configurado sea entero. */
  integer?: boolean;
}

/** Lee un intervalo de entorno y devuelve el fallback cuando la configuración no es válida. */
export function readIntervalMs(name: string, fallback: number, options: IntervalOptions): number {
  const rawValue = process.env[name] ?? (options.fallbackName ? process.env[options.fallbackName] : undefined);
  const configured = Number(rawValue);
  const validNumber = Number.isFinite(configured) && (!options.integer || Number.isSafeInteger(configured));
  return validNumber && configured >= options.minimum ? configured : fallback;
}

/** Espera el tiempo indicado y permite interrumpir la espera con una señal de apagado. */
export function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Ejecuta tareas periódicas en paralelo; cada tarea conserva su intervalo y manejo de errores. */
export async function runPeriodicTasks(
  tasks: PeriodicTask[],
  signal: AbortSignal,
  initialDelayMs: number,
  onTaskStart?: (task: PeriodicTask) => void
): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      onTaskStart?.(task);
      await waitFor(initialDelayMs, signal);

      while (!signal.aborted) {
        const startedAt = Date.now();
        try {
          await task.execute();
        } catch (error) {
          if (task.onError) {
            task.onError(error);
          } else {
            console.error(
              JSON.stringify({
                msg: `${task.name}.worker-tick-error`,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
        }

        console.info(JSON.stringify({ msg: `${task.name}.worker-tick-finished`, durationMs: Date.now() - startedAt }));
        await waitFor(task.intervalMs, signal);
      }
    })
  );
}

/** Instala el manejo común de SIGINT/SIGTERM y ejecuta un worker con cierre cooperativo. */
export function startWorker(name: string, run: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  const shutdown = (signal: NodeJS.Signals) => {
    console.info(`[${name}] Señal ${signal} recibida; deteniendo el worker.`);
    controller.abort();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  void run(controller.signal)
    .catch((error: unknown) => {
      console.error(`[${name}] Error fatal:`, error);
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
    });
}
