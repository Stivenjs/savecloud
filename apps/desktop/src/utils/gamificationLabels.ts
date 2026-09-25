import i18n from "@lib/i18n";

export function achievementLabel(id: string): string {
  return i18n.t(`profile.achievements.${id}`, id);
}

/** Formatea segundos hasta el siguiente nivel como horas enteras (ceil). */
export function formatHoursToNextLevel(seconds: number): string {
  if (seconds <= 0) return "0 h";
  const h = Math.ceil(seconds / 3600);
  return `${h} h`;
}
