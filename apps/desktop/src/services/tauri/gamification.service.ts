import { invoke } from "@tauri-apps/api/core";
import type { GamificationState } from "@app-types/gamification";

/** Obtiene el estado de la gamificación */
export async function getGamificationState(): Promise<GamificationState> {
  return invoke<GamificationState>("get_gamification_state");
}

/** Consume las notificaciones de logros */
export async function consumeAchievementToasts(): Promise<string[]> {
  return invoke<string[]>("consume_achievement_toasts");
}

/** Marca la notificación de accesibilidad como vista */
export async function markShortcutsHintSeen(): Promise<void> {
  await invoke("mark_shortcuts_hint_seen");
}

/** Marca la notificación de resumen semanal como vista */
export async function markWeeklyDigestNotified(weekId: string): Promise<void> {
  await invoke("mark_weekly_digest_notified", { weekId });
}

/** Verifica si se debe mostrar la notificación de resumen semanal */
export async function shouldShowWeeklyDigestNotification(currentWeekId: string): Promise<boolean> {
  return invoke<boolean>("should_show_weekly_digest_notification", { currentWeekId });
}
