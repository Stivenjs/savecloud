type RequestGate = {
  nextStartAt: number;
  tail: Promise<void>;
};

const gates = new Map<string, RequestGate>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Espacia el inicio de solicitudes por host frente a ticks concurrentes de este proceso. */
export async function waitForRequestSlot(host: string, minimumIntervalMs: number): Promise<void> {
  const gate = gates.get(host) ?? { nextStartAt: 0, tail: Promise.resolve() };
  gates.set(host, gate);

  let release!: () => void;
  const previous = gate.tail;
  gate.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  const slotAt = Math.max(Date.now(), gate.nextStartAt);
  gate.nextStartAt = slotAt + Math.max(0, minimumIntervalMs);
  release();
  await sleep(Math.max(0, slotAt - Date.now()));
}

export function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
