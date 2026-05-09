//! Prioridad de CPU automática para procesos de juego detectados (independiente del modo juego manual).

use std::collections::HashSet;

use super::session_file::{self as sf, CpuBoostRecord, GameModeSessionFile};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DetectedGameProcess {
    pub game_id: String,
    pub pid: u32,
    pub exe_name_lc: String,
}

pub fn reconcile_stale_on_startup() {
    let mut sess = sf::load_session();
    if sess.cpu_boost_records.is_empty() {
        return;
    }
    log::warn!(
        "[CpuBoost] Sesión con prioridades pendientes de revertir — restaurando {} proceso(s)",
        sess.cpu_boost_records.len()
    );
    for rec in &sess.cpu_boost_records {
        restore_one_record(rec);
    }
    sess.cpu_boost_records.clear();
    if let Err(e) = persist_trimmed(&sess) {
        log::warn!("[CpuBoost] No se pudo limpiar sesión tras reconcile: {e}");
    }
}

pub fn sync_detected_game_cpu_boost(
    enabled: bool,
    any_game_running: bool,
    candidates: &[DetectedGameProcess],
) {
    let mut sess = sf::load_session();

    if !enabled || !any_game_running {
        revert_all_tracked(&mut sess);
        return;
    }

    let desired_keys: HashSet<(u32, &str)> = candidates
        .iter()
        .map(|c| (c.pid, c.exe_name_lc.as_str()))
        .collect();

    let mut still_tracked: Vec<CpuBoostRecord> = Vec::new();
    for rec in std::mem::take(&mut sess.cpu_boost_records) {
        let key = (rec.pid, rec.exe_name_lc.as_str());
        if desired_keys.contains(&key) {
            still_tracked.push(rec);
        } else {
            restore_one_record(&rec);
        }
    }
    sess.cpu_boost_records = still_tracked;

    let tracked_pids: HashSet<u32> = sess.cpu_boost_records.iter().map(|r| r.pid).collect();

    for c in candidates {
        if tracked_pids.contains(&c.pid) {
            continue;
        }
        if let Some(record) = try_apply_boost(c) {
            sess.cpu_boost_records.push(record);
        }
    }

    if let Err(e) = persist_trimmed(&sess) {
        log::warn!("[CpuBoost] persistencia sesión: {e}");
    }
}

fn persist_trimmed(sess: &GameModeSessionFile) -> Result<(), String> {
    if sf::session_fully_cleared(sess) {
        sf::clear_session_file()
    } else {
        sf::save_session(sess)
    }
}

fn revert_all_tracked(sess: &mut GameModeSessionFile) {
    for rec in std::mem::take(&mut sess.cpu_boost_records) {
        restore_one_record(&rec);
    }
    if let Err(e) = persist_trimmed(sess) {
        log::warn!("[CpuBoost] persistencia al revertir todo: {e}");
    }
}

fn restore_one_record(rec: &CpuBoostRecord) {
    #[cfg(target_os = "windows")]
    {
        if let Some(prev) = rec.prev_windows_priority_class {
            if let Err(e) = win_set_priority_class(rec.pid, prev) {
                log::debug!(
                    "[CpuBoost] No se restauró prioridad pid={} ({}): {e}",
                    rec.pid,
                    rec.exe_name_lc
                );
            }
        }
    }
    #[cfg(all(unix, not(target_os = "windows")))]
    {
        if let Some(prev) = rec.prev_unix_nice {
            if let Err(e) = unix_set_nice(rec.pid, prev) {
                log::debug!(
                    "[CpuBoost] No se restauró nice pid={} ({}): {e}",
                    rec.pid,
                    rec.exe_name_lc
                );
            }
        }
    }
}

fn try_apply_boost(c: &DetectedGameProcess) -> Option<CpuBoostRecord> {
    #[cfg(target_os = "windows")]
    {
        let prev = match win_get_priority_class(c.pid) {
            Ok(v) => v,
            Err(e) => {
                log::warn!(
                    "[CpuBoost] No se puede abrir/leer prioridad pid={} ({}): {e}",
                    c.pid,
                    c.exe_name_lc
                );
                return None;
            }
        };
        if win_should_skip_boost(prev) {
            log::trace!(
                "[CpuBoost] Sin cambio pid={} ({}) clase={:#x} ya alta/suficiente",
                c.pid,
                c.exe_name_lc,
                prev
            );
            return None;
        }
        if let Err(e) = win_set_priority_class(c.pid, win_above_normal()) {
            log::warn!(
                "[CpuBoost] SetPriorityClass pid={} ({}) falló ({e}); antivirus/proceso protegido pueden bloquearlo",
                c.pid,
                c.exe_name_lc
            );
            return None;
        }
        log::info!(
            "[CpuBoost] Prioridad elevada pid={} ({}) clase_anterior={:#x}",
            c.pid,
            c.exe_name_lc,
            prev
        );
        Some(CpuBoostRecord {
            pid: c.pid,
            exe_name_lc: c.exe_name_lc.clone(),
            prev_windows_priority_class: Some(prev),
            prev_unix_nice: None,
        })
    }
    #[cfg(all(unix, not(target_os = "windows")))]
    {
        let prev = unix_get_nice(c.pid).ok()?;
        if prev < 0 {
            return None;
        }
        let target = (prev - 5).max(-10);
        if target >= prev {
            return None;
        }
        if unix_set_nice(c.pid, target).is_err() {
            log::warn!(
                "[CpuBoost] setpriority pid={} ({}) — permisos insuficientes o proceso terminado",
                c.pid,
                c.exe_name_lc
            );
            return None;
        }
        return Some(CpuBoostRecord {
            pid: c.pid,
            exe_name_lc: c.exe_name_lc.clone(),
            prev_windows_priority_class: None,
            prev_unix_nice: Some(prev),
        });
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = c;
        None
    }
}

#[cfg(target_os = "windows")]
mod win {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{
        GetPriorityClass, OpenProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS,
        HIGH_PRIORITY_CLASS, PROCESS_ACCESS_RIGHTS, PROCESS_CREATION_FLAGS,
        PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
        REALTIME_PRIORITY_CLASS,
    };

    const OPEN_PRIORITY_TRY: PROCESS_ACCESS_RIGHTS =
        PROCESS_ACCESS_RIGHTS(PROCESS_QUERY_INFORMATION.0 | PROCESS_SET_INFORMATION.0);

    const OPEN_PRIORITY_FALLBACK: PROCESS_ACCESS_RIGHTS =
        PROCESS_ACCESS_RIGHTS(PROCESS_QUERY_LIMITED_INFORMATION.0 | PROCESS_SET_INFORMATION.0);

    unsafe fn open_process_boost(pid: u32) -> windows::core::Result<HANDLE> {
        OpenProcess(OPEN_PRIORITY_TRY, false, pid)
            .or_else(|_| OpenProcess(OPEN_PRIORITY_FALLBACK, false, pid))
    }

    pub(super) fn above_normal() -> u32 {
        ABOVE_NORMAL_PRIORITY_CLASS.0
    }

    pub(super) fn should_skip_boost(current: u32) -> bool {
        current == ABOVE_NORMAL_PRIORITY_CLASS.0
            || current == HIGH_PRIORITY_CLASS.0
            || current == REALTIME_PRIORITY_CLASS.0
    }

    pub(super) fn get_priority_class(pid: u32) -> Result<u32, String> {
        unsafe {
            let handle = open_process_boost(pid).map_err(|e| format!("OpenProcess {pid}: {e}"))?;

            let class = GetPriorityClass(handle);
            let _ = CloseHandle(handle);
            if class == 0 {
                return Err(format!("GetPriorityClass {pid} falló"));
            }
            Ok(class)
        }
    }

    pub(super) fn set_priority_class(pid: u32, class: u32) -> Result<(), String> {
        unsafe {
            let handle =
                open_process_boost(pid).map_err(|e| format!("OpenProcess(set) {pid}: {e}"))?;

            SetPriorityClass(handle, PROCESS_CREATION_FLAGS(class))
                .map_err(|e| format!("SetPriorityClass {pid}: {e}"))?;
            let _ = CloseHandle(handle);
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
use win as win_impl;

#[cfg(target_os = "windows")]
fn win_above_normal() -> u32 {
    win_impl::above_normal()
}

#[cfg(target_os = "windows")]
fn win_should_skip_boost(current: u32) -> bool {
    win_impl::should_skip_boost(current)
}

#[cfg(target_os = "windows")]
fn win_get_priority_class(pid: u32) -> Result<u32, String> {
    win_impl::get_priority_class(pid)
}

#[cfg(target_os = "windows")]
fn win_set_priority_class(pid: u32, class: u32) -> Result<(), String> {
    win_impl::set_priority_class(pid, class)
}

#[cfg(all(unix, not(target_os = "windows")))]
fn unix_get_nice(pid: u32) -> Result<i32, String> {
    clear_errno();
    let r = unsafe { libc::getpriority(libc::PRIO_PROCESS as _, pid as libc::id_t) as i32 };
    if r == -1 && errno_nonzero() {
        Err(format!("getpriority {pid}"))
    } else {
        Ok(r)
    }
}

#[cfg(all(unix, not(target_os = "windows")))]
fn unix_set_nice(pid: u32, nice: i32) -> Result<(), String> {
    let rc = unsafe { libc::setpriority(libc::PRIO_PROCESS as _, pid as libc::id_t, nice) };
    if rc != 0 {
        Err(format!("setpriority {pid} -> {nice}: errno"))
    } else {
        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "windows")))]
fn clear_errno() {
    unsafe {
        *errno_location() = 0;
    }
}

#[cfg(all(unix, not(target_os = "windows")))]
fn errno_nonzero() -> bool {
    unsafe { *errno_location() != 0 }
}

#[cfg(all(unix, not(target_os = "windows")))]
unsafe fn errno_location() -> *mut libc::c_int {
    #[cfg(target_os = "linux")]
    {
        libc::__errno_location()
    }
    #[cfg(target_os = "macos")]
    {
        libc::__error()
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        libc::__errno_location()
    }
}

#[cfg(all(test, target_os = "windows"))]
mod win_skip_policy_tests {
    use windows::Win32::System::Threading::{
        ABOVE_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS,
        NORMAL_PRIORITY_CLASS, REALTIME_PRIORITY_CLASS,
    };

    #[test]
    fn skip_high_and_realtime_not_normal() {
        assert!(!super::win_should_skip_boost(NORMAL_PRIORITY_CLASS.0));
        assert!(!super::win_should_skip_boost(IDLE_PRIORITY_CLASS.0));
        assert!(super::win_should_skip_boost(HIGH_PRIORITY_CLASS.0));
        assert!(super::win_should_skip_boost(REALTIME_PRIORITY_CLASS.0));
        assert!(super::win_should_skip_boost(ABOVE_NORMAL_PRIORITY_CLASS.0));
    }
}
