//! Mitigaciones de energía y captura (HKCU) en Windows mediante `powercfg` y WinReg.

#![cfg(target_os = "windows")]

use regex::Regex;
use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use winreg::enums::KEY_READ;
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) const HIGH_PERFORMANCE_SCHEME_GUID: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

pub(crate) fn capture_power_scheme_from_output(stdout: &str) -> Option<String> {
    let re =
        Regex::new(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
            .ok()?;
    let caps = re.captures_iter(stdout).next()?.get(0)?;
    Some(caps.as_str().to_ascii_lowercase())
}

fn run_hidden(cmd: &mut std::process::Command) -> std::io::Result<std::process::Output> {
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output()
}

pub(crate) fn get_active_power_scheme_guid() -> Result<String, String> {
    let out = run_hidden(
        std::process::Command::new("powercfg")
            .args(["/getactivescheme"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()),
    )
    .map_err(|e| format!("powercfg /getactivescheme: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string()
        + String::from_utf8_lossy(&out.stderr).as_ref();
    if !out.status.success() {
        return Err(format!("powercfg devolvió error: {}", text.trim()));
    }
    capture_power_scheme_from_output(&text).ok_or_else(|| {
        format!(
            "no se pudo parsear GUID del plan activo desde: {}",
            text.trim()
        )
    })
}

pub(crate) fn set_active_power_scheme(guid: &str) -> Result<(), String> {
    let g = guid.trim();
    let out = run_hidden(
        std::process::Command::new("powercfg")
            .args(["/setactive", g])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()),
    )
    .map_err(|e| format!("powercfg /setactive: {e}"))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        let out_msg = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "powercfg /setactive falló (stdout={} stderr={}) guid={}",
            out_msg.trim(),
            msg.trim(),
            g
        ));
    }
    Ok(())
}

pub(crate) fn activate_game_mode_windows_power_plan() -> Result<(), String> {
    set_active_power_scheme(HIGH_PERFORMANCE_SCHEME_GUID)
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum DvrSnap {
    Absent,
    Value(u32),
}

pub(crate) fn read_game_dvr_state() -> Result<DvrSnap, String> {
    let hkcu = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let Ok(dvr) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\GameDVR",
        KEY_READ,
    ) else {
        return Ok(DvrSnap::Absent);
    };
    match dvr.get_value::<u32, _>("AppCaptureEnabled") {
        Ok(v) => Ok(DvrSnap::Value(v)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(DvrSnap::Absent),
        Err(e) => Err(format!("leer GameDVR AppCaptureEnabled: {e}")),
    }
}

pub(crate) fn write_game_dvr_app_capture(dw: Option<u32>) -> Result<(), String> {
    let hkcu = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let (dvr, _) = hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\GameDVR")
        .map_err(|e| format!("abrir GameDVR: {e}"))?;

    match dw {
        None => {
            let _ignore = dvr.delete_value("AppCaptureEnabled");
            Ok(())
        }
        Some(v) => dvr
            .set_value("AppCaptureEnabled", &v)
            .map_err(|e| format!("escribir GameDVR AppCaptureEnabled: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_guid_parses_powercfg_locale_shape() {
        let sample =
            "GUID del plan de energía activo: 381b4222-f694-41f9-993b-9725c8439c71  (Equilibrado)";
        assert_eq!(
            capture_power_scheme_from_output(sample).as_deref(),
            Some("381b4222-f694-41f9-993b-9725c8439c71")
        );
    }
}
