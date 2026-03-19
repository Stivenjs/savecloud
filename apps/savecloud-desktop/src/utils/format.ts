/**
 * Formatea bytes a string legible (KB, MB, GB, TB).
 */
export function formatBytes(bytes: number): string {
  return formatSize(bytes);
}

/**
 * Alias usado por GamesStats. Formatea bytes a string legible.
 */
function formatSizeImpl(bytes: number): string {
  if (bytes === 0 || !Number.isFinite(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;
  while (value >= k && i < sizes.length - 1) {
    value /= k;
    i += 1;
  }
  const unit = sizes[i];
  const formatted =
    i === 0
      ? String(Math.round(value))
      : value >= 100
        ? Math.round(value).toLocaleString()
        : value >= 1
          ? value.toFixed(1)
          : value.toFixed(2);
  return `${formatted} ${unit}`;
}

export function formatSize(bytes: number): string {
  return formatSizeImpl(bytes);
}

/**
 * Formatea una fecha a texto relativo (hace X minutos, hoy, ayer, etc.).
 */
export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function formatPlaytime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Formatea la fecha de sincronización a un formato relativo amigable.
 */
export function formatLastSync(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Hace un momento";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;

  return date.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
