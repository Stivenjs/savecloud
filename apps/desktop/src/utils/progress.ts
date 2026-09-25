/** Formatea velocidad en bytes/segundo a string legible (KB/s, MB/s). */
export function formatSpeed(bps: number | null): string {
  if (bps == null || bps <= 0) return "—";
  const mbps = bps / (1024 * 1024);
  if (mbps < 1) {
    const kbps = bps / 1024;
    return `${kbps.toFixed(1)} KB/s`;
  }
  return `${mbps.toFixed(1)} MB/s`;
}

/** Formatea un ETA en segundos a string legible (Xd Xh, Xh Xm, Xm Xs). */
export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
