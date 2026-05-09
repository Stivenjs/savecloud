//! macOS (`caffeinate`) y Linux (`powerprofilesctl`).

#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
pub(crate) fn start_caffeinate() -> Result<u32, String> {
    let child = Command::new("caffeinate")
        .args(["-dimsu"]) // inhibit idle/sleep/display/disk
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("caffeinate: {e}"))?;
    Ok(child.id())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn start_caffeinate() -> Result<u32, String> {
    Err("caffeinate no disponible en este SO".to_string())
}

#[cfg(target_os = "macos")]
pub(crate) fn stop_caffeinate(pid: Option<u32>) -> Result<(), String> {
    let Some(pid) = pid else {
        return Ok(());
    };
    let status = Command::new("kill")
        .args([pid.to_string()])
        .status()
        .map_err(|e| format!("kill caffeinate pid {pid}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "kill caffeinate pid {} salió con {:?}",
            pid,
            status.code()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn stop_caffeinate(_pid: Option<u32>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn read_linux_power_profile() -> Option<String> {
    None
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn set_linux_power_profile(_profile: &str) -> Result<(), String> {
    Err("powerprofilesctl no disponible".to_string())
}

#[cfg(target_os = "linux")]
fn run_powerprofiles(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("powerprofilesctl")
        .args(args)
        .output()
        .map_err(|e| format!("powerprofilesctl: {e}"))
}

#[cfg(target_os = "linux")]
pub(crate) fn read_linux_power_profile() -> Option<String> {
    let out = run_powerprofiles(&["get"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn set_linux_power_profile(profile: &str) -> Result<(), String> {
    let out = run_powerprofiles(&["set", profile.trim()])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "powerprofilesctl set {}: {}",
            profile.trim(),
            detail
        ));
    }
    Ok(())
}
