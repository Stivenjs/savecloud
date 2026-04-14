const LABELS: Record<string, string> = {
  first_upload: "Primera subida a la nube",
  syncs_10: "10 sincronizaciones exitosas",
  syncs_100: "100 sincronizaciones exitosas",
  hours_100: "100 horas de juego registradas",
};

export function achievementLabel(id: string): string {
  return LABELS[id] ?? id;
}

/** Formatea segundos hasta el siguiente nivel como horas enteras (ceil). */
export function formatHoursToNextLevel(seconds: number): string {
  if (seconds <= 0) return "0 h";
  const h = Math.ceil(seconds / 3600);
  return `${h} h`;
}
