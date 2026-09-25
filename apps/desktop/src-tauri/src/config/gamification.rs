//! Lógica de gamificación local. El estado vive en `GamificationConfig` y se persiste vía `io`
//! (archivo dedicado y campo en el JSON monolítico para export/import y nube).

use chrono::{Datelike, Utc};
use serde::Serialize;
use std::collections::HashSet;

use crate::config::models::GamificationConfig;
use crate::time;

const ACH_FIRST_UPLOAD: &str = "first_upload";
const ACH_SYNCS_10: &str = "syncs_10";
const ACH_SYNCS_100: &str = "syncs_100";
const ACH_HOURS_100: &str = "hours_100";

/// Misma regla que la UI histórica: `floor(sqrt(max(1, horas))) + 1` en 1..99.
pub fn level_from_total_seconds(total_seconds: u64) -> u8 {
    let hours = (total_seconds as f64 / 3600.0).max(1.0);
    let v = hours.sqrt().floor() as u32 + 1;
    v.clamp(1, 99) as u8
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelProgressDto {
    pub level: u8,
    pub next_level: u8,
    pub progress_to_next_level: f64,
    pub seconds_to_next_level: u64,
}

pub fn level_progress(total_seconds: u64) -> LevelProgressDto {
    let h = (total_seconds as f64 / 3600.0).max(1.0);
    let level = level_from_total_seconds(total_seconds);
    if level >= 99 {
        return LevelProgressDto {
            level: 99,
            next_level: 99,
            progress_to_next_level: 1.0,
            seconds_to_next_level: 0,
        };
    }
    let next_level = level + 1;
    let lower_h = (level.saturating_sub(1) as f64).powi(2);
    let upper_h = (level as f64).powi(2);
    let span = (upper_h - lower_h).max(0.000_001);
    let progress_to_next_level = ((h - lower_h) / span).clamp(0.0, 1.0);
    let seconds_to_next_level = ((upper_h * 3600.0) - total_seconds as f64).max(0.0) as u64;
    LevelProgressDto {
        level,
        next_level,
        progress_to_next_level,
        seconds_to_next_level,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamificationStateDto {
    pub level_progress: LevelProgressDto,
    pub weekly_playtime_seconds: u64,
    pub week_id: String,
    pub sync_streak_days: u32,
    pub play_streak_days: u32,
    pub upload_success_count: u64,
    pub achievements_unlocked: Vec<String>,
    pub pending_achievement_toasts: Vec<String>,
    pub seen_shortcuts_hint: bool,
    pub privacy_note: &'static str,
}

fn current_week_id() -> String {
    let now = Utc::now().date_naive();
    let iso = now.iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}

fn trim_dates(v: &mut Vec<String>, max: usize) {
    if v.len() > max {
        let drop = v.len() - max;
        v.drain(0..drop);
    }
}

fn date_set_streak(days: &HashSet<String>) -> u32 {
    let today = Utc::now().date_naive();
    let fmt = |d: chrono::NaiveDate| d.format("%Y-%m-%d").to_string();

    let start = if days.contains(&fmt(today)) {
        today
    } else if let Some(y) = today.pred_opt() {
        if days.contains(&fmt(y)) {
            y
        } else {
            return 0;
        }
    } else {
        return 0;
    };

    let mut d = start;
    let mut n: u32 = 0;
    for _ in 0..366 {
        if days.contains(&fmt(d)) {
            n += 1;
            if let Some(p) = d.pred_opt() {
                d = p;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    n
}

fn ensure_week_rollover(g: &mut GamificationConfig) {
    let wid = current_week_id();
    if g.week_id != wid {
        g.week_id = wid.clone();
        g.weekly_playtime_seconds = 0;
    }
    if g.week_id.is_empty() {
        g.week_id = wid;
    }
}

fn has_achievement(g: &GamificationConfig, id: &str) -> bool {
    g.achievements_unlocked.iter().any(|s| s == id)
}

fn unlock(g: &mut GamificationConfig, id: &'static str) {
    if has_achievement(g, id) {
        return;
    }
    g.achievements_unlocked.push(id.to_string());
    g.pending_achievement_toasts.push(id.to_string());
}

fn check_achievements_with_total(g: &mut GamificationConfig, total_playtime_seconds: u64) {
    if g.upload_success_count >= 1 {
        unlock(g, ACH_FIRST_UPLOAD);
    }
    if g.upload_success_count >= 10 {
        unlock(g, ACH_SYNCS_10);
    }
    if g.upload_success_count >= 100 {
        unlock(g, ACH_SYNCS_100);
    }
    if total_playtime_seconds >= 100 * 3600 {
        unlock(g, ACH_HOURS_100);
    }
}

/// Tras un upload exitoso registrado en historial (misma transacción lógica que `append_operation_log`).
pub fn on_operation_logged_inner(
    g: &mut GamificationConfig,
    kind: &str,
    file_count: u32,
    err_count: u32,
) {
    if kind != "upload" || err_count > 0 || file_count == 0 {
        return;
    }
    g.upload_success_count = g.upload_success_count.saturating_add(1);

    let today = Utc::now().format("%Y-%m-%d").to_string();
    if !g.utc_days_with_sync.contains(&today) {
        g.utc_days_with_sync.push(today);
        trim_dates(&mut g.utc_days_with_sync, 400);
    }

    check_achievements_with_total(g, time::get_total_playtime());
}

/// Actualiza rachas, semana ISO y logros tras sumar tiempo de juego.
/// `total_playtime_seconds` debe ser la suma en memoria tras actualizar el juego (antes de persistir).
pub fn apply_playtime_delta(g: &mut GamificationConfig, seconds: u64, total_playtime_seconds: u64) {
    if seconds == 0 {
        return;
    }
    ensure_week_rollover(g);
    g.weekly_playtime_seconds = g.weekly_playtime_seconds.saturating_add(seconds);

    let today = Utc::now().format("%Y-%m-%d").to_string();
    if !g.utc_days_with_play.contains(&today) {
        g.utc_days_with_play.push(today);
        trim_dates(&mut g.utc_days_with_play, 400);
    }

    check_achievements_with_total(g, total_playtime_seconds);
}

pub fn build_state_dto(
    g: &GamificationConfig,
    total_playtime_seconds: u64,
) -> GamificationStateDto {
    let sync_set: HashSet<String> = g.utc_days_with_sync.iter().cloned().collect();
    let play_set: HashSet<String> = g.utc_days_with_play.iter().cloned().collect();

    GamificationStateDto {
        level_progress: level_progress(total_playtime_seconds),
        weekly_playtime_seconds: g.weekly_playtime_seconds,
        week_id: if g.week_id.is_empty() {
            current_week_id()
        } else {
            g.week_id.clone()
        },
        sync_streak_days: date_set_streak(&sync_set),
        play_streak_days: date_set_streak(&play_set),
        upload_success_count: g.upload_success_count,
        achievements_unlocked: g.achievements_unlocked.clone(),
        pending_achievement_toasts: g.pending_achievement_toasts.clone(),
        seen_shortcuts_hint: g.seen_shortcuts_hint,
        privacy_note: "Estadísticas y rachas solo en este dispositivo; no se envían a la nube.",
    }
}

/// Combina dos estados al importar con modo merge (máximos y unión de logros/días).
pub fn merge_gamification(a: &GamificationConfig, b: &GamificationConfig) -> GamificationConfig {
    let mut out = a.clone();
    out.upload_success_count = out.upload_success_count.max(b.upload_success_count);
    out.weekly_playtime_seconds = out.weekly_playtime_seconds.max(b.weekly_playtime_seconds);

    for d in &b.utc_days_with_sync {
        if !out.utc_days_with_sync.contains(d) {
            out.utc_days_with_sync.push(d.clone());
        }
    }
    for d in &b.utc_days_with_play {
        if !out.utc_days_with_play.contains(d) {
            out.utc_days_with_play.push(d.clone());
        }
    }
    for id in &b.achievements_unlocked {
        if !out.achievements_unlocked.contains(id) {
            out.achievements_unlocked.push(id.clone());
        }
    }
    out.pending_achievement_toasts.clear();
    out.seen_shortcuts_hint = out.seen_shortcuts_hint && b.seen_shortcuts_hint;
    if b.last_weekly_digest_notification_week_id > out.last_weekly_digest_notification_week_id {
        out.last_weekly_digest_notification_week_id =
            b.last_weekly_digest_notification_week_id.clone();
    }
    out
}
