import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

interface OperationMetric {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const metrics = new Map<string, OperationMetric>();
let flushTimer: ReturnType<typeof setInterval> | undefined;

/** Activa un resumen periódico del volumen y la latencia de operaciones DynamoDB. */
export function registerDynamoOperationMetrics(client: DynamoDBClient): void {
  if (process.env.DYNAMODB_OPERATION_METRICS?.trim().toLowerCase() !== "true") return;

  client.middlewareStack.add(
    (next) => async (args) => {
      const request = (args as unknown as { request?: { headers?: Record<string, string> } }).request;
      const target = request?.headers?.["x-amz-target"] ?? "operacion-desconocida";
      const operation = target.split(".").at(-1) ?? "operacion-desconocida";
      const start = performance.now();
      let failed = false;
      try {
        return await next(args);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        const elapsed = performance.now() - start;
        const current = metrics.get(operation) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
        current.count += 1;
        current.errors += Number(failed);
        current.totalMs += elapsed;
        current.maxMs = Math.max(current.maxMs, elapsed);
        metrics.set(operation, current);
      }
    },
    { name: "savecloudDynamoOperationMetrics", step: "finalizeRequest", priority: "low" }
  );

  flushTimer ??= setInterval(() => {
    if (metrics.size === 0) return;
    const summary = Object.fromEntries(
      [...metrics.entries()].map(([operation, value]) => [
        operation,
        {
          count: value.count,
          errors: value.errors,
          averageMs: Number((value.totalMs / value.count).toFixed(2)),
          maxMs: Number(value.maxMs.toFixed(2)),
        },
      ])
    );
    metrics.clear();
    console.info("[DynamoDB] Resumen de operaciones del último minuto.", summary);
  }, 60_000);
  flushTimer.unref?.();
}
