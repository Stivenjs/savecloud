import { Download, Upload, Users, type LucideIcon } from "lucide-react";
import type { OperationLogEntry } from "@services/tauri";

/** Etiqueta legible del tipo de operación (UI en español). */
export function formatOperationLogKind(kind: OperationLogEntry["kind"]): string {
  switch (kind) {
    case "upload":
      return "Subida";
    case "download":
      return "Descarga";
    case "copy_friend":
      return "Copia desde amigo";
    default:
      return kind;
  }
}

/** Fecha/hora local legible para una marca ISO. */
export function formatOperationLogTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

/** Texto corto relativo para listados (p. ej. historial). */
export function formatOperationLogRelativeTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "";
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  if (s < 45) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  if (h < 24) return `hace ${h} h`;
  if (days < 7) return `hace ${days} d`;
  return "";
}

/** Clave YYYY-MM-DD en calendario local para agrupar. */
export function getLocalDayKey(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Título de grupo: Hoy, Ayer o fecha larga en español. */
export function formatDayGroupHeading(dayKey: string): string {
  if (dayKey === "unknown") return "Sin fecha";
  const [y, m, day] = dayKey.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startD = new Date(d);
  startD.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startToday.getTime() - startD.getTime()) / 86_400_000);
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export interface OperationHistoryDayGroup {
  dayKey: string;
  dayLabel: string;
  entries: OperationLogEntry[];
}

export function groupOperationLogEntriesByDay(entries: OperationLogEntry[]): OperationHistoryDayGroup[] {
  const map = new Map<string, OperationLogEntry[]>();
  for (const e of entries) {
    const key = getLocalDayKey(e.timestamp);
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  const sortedKeys = [...map.keys()].filter((k) => k !== "unknown").sort((a, b) => b.localeCompare(a));
  if (map.has("unknown")) sortedKeys.push("unknown");
  return sortedKeys.map((dayKey) => ({
    dayKey,
    dayLabel: formatDayGroupHeading(dayKey),
    entries: map.get(dayKey) ?? [],
  }));
}

export const OPERATION_LOG_KIND_ICON: Record<OperationLogEntry["kind"], LucideIcon> = {
  upload: Upload,
  download: Download,
  copy_friend: Users,
};

export const OPERATION_LOG_KIND_CHIP_COLOR: Record<OperationLogEntry["kind"], "primary" | "secondary" | "success"> = {
  upload: "primary",
  download: "secondary",
  copy_friend: "success",
};

export interface OperationLogSummary {
  total: number;
  byKind: Record<OperationLogEntry["kind"], number>;
  lastTimestamp: string | null;
}

export function computeOperationLogSummary(entries: OperationLogEntry[]): OperationLogSummary | null {
  if (entries.length === 0) return null;
  const byKind: Record<OperationLogEntry["kind"], number> = {
    upload: 0,
    download: 0,
    copy_friend: 0,
  };
  for (const e of entries) {
    byKind[e.kind] += 1;
  }
  const last = entries[0]?.timestamp ?? null;
  return { total: entries.length, byKind, lastTimestamp: last };
}
