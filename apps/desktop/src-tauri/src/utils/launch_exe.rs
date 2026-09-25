//! Lanzamiento **dinámico** del recurso configurado como “abrir este juego” (`.exe`, `.jar`, script, etc.; sin rutas fijas ni nombres comerciales).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[cfg(windows)]
const ERROR_ELEVATION_REQUIRED: i32 = 740;

pub fn launch_game_executable(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("El archivo no existe: {}", path));
    }

    let ext = extension_lower(p).unwrap_or_default();

    match ext.as_str() {
        "jar" => jar_dynamic_launch(p),
        #[cfg(windows)]
        "bat" | "cmd" => spawn_windows_cmd_script(path),
        #[cfg(not(windows))]
        "sh" => spawn_unix_shell_script(path),
        _ => spawn_native_executable(path),
    }
}

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()?.to_str().map(|s| s.to_ascii_lowercase())
}

fn cwd_parent(file: &Path) -> PathBuf {
    file.parent()
        .filter(|d| !d.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn push_unique(out: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, p: PathBuf) {
    if seen.insert(p.clone()) {
        out.push(p);
    }
}

#[cfg(windows)]
fn java_runner_candidates_windows() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    if let Some(root) = std::env::var_os("JAVA_HOME") {
        let b = PathBuf::from(root);
        let jw = b.join("bin").join("javaw.exe");
        if jw.is_file() {
            push_unique(&mut out, &mut seen, jw);
        }
        let ja = b.join("bin").join("java.exe");
        if ja.is_file() {
            push_unique(&mut out, &mut seen, ja);
        }
    }

    for name in ["javaw.exe", "javaw", "java.exe", "java"] {
        if let Ok(p) = which::which(name) {
            push_unique(&mut out, &mut seen, p);
        }
    }

    out
}

#[cfg(not(windows))]
fn java_runner_candidates_unix() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    if let Some(root) = std::env::var_os("JAVA_HOME") {
        let ja = PathBuf::from(root).join("bin").join("java");
        if ja.is_file() {
            push_unique(&mut out, &mut seen, ja);
        }
    }

    if let Ok(p) = which::which("java") {
        push_unique(&mut out, &mut seen, p);
    }

    out
}

#[cfg(windows)]
fn spawn_java_minus_jar(java_bin: &Path, jar_utf8: &str, cwd: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new(java_bin);
    cmd.args(["-jar", jar_utf8]).current_dir(cwd);

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) => {
            jar_elevated_uac(java_bin, jar_utf8, cwd)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
fn spawn_java_minus_jar(java_bin: &Path, jar_utf8: &str, cwd: &Path) -> Result<(), String> {
    std::process::Command::new(java_bin)
        .args(["-jar", jar_utf8])
        .current_dir(cwd)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn jar_dynamic_launch(jar_path: &Path) -> Result<(), String> {
    let cwd = cwd_parent(jar_path);
    let jar_arg = jar_path.to_str().ok_or_else(|| {
        "La ruta del .jar no es UTF‑8 válida para la línea de comandos.".to_string()
    })?;

    #[cfg(windows)]
    for exe in java_runner_candidates_windows() {
        if spawn_java_minus_jar(&exe, jar_arg, &cwd).is_ok() {
            return Ok(());
        }
    }
    #[cfg(not(windows))]
    for exe in java_runner_candidates_unix() {
        if spawn_java_minus_jar(&exe, jar_arg, &cwd).is_ok() {
            return Ok(());
        }
    }

    #[cfg(windows)]
    {
        std::process::Command::new("cmd.exe")
            .current_dir(&cwd)
            .args(["/c", "start", "", jar_arg])
            .spawn()
            .map(|_| ())
            .map_err(|e| {
                format!(
                    "No se lanzó el .jar con JAVA_HOME/PATH ni con la asociación predeterminada de Windows (`start`): {e}"
                )
            })
    }

    #[cfg(not(windows))]
    {
        Err("No hay intérprete Java en JAVA_HOME/PATH (`java`).".to_string())
    }
}

#[cfg(windows)]
fn jar_elevated_uac(java: &Path, jar_arg: &str, cwd: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let java_w: Vec<u16> = java.as_os_str().encode_wide().chain(Some(0)).collect();
    let params = format!("-jar {}", shell_escape_windows_arg(jar_arg));
    let params_w: Vec<u16> = OsStr::new(params.as_str())
        .encode_wide()
        .chain(Some(0))
        .collect();
    let dir_w: Vec<u16> = cwd.as_os_str().encode_wide().chain(Some(0)).collect();

    unsafe {
        let runas: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
        let h = ShellExecuteW(
            ptr::null_mut(),
            runas.as_ptr(),
            java_w.as_ptr(),
            params_w.as_ptr(),
            dir_w.as_ptr(),
            SW_SHOWNORMAL,
        );
        if (h as isize) <= 32 {
            Err(format!(
                "ShellExecute (runas/UAC) falló al lanzar Java (código {}).",
                h as isize
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn shell_escape_windows_arg(s: &str) -> String {
    if !s.contains(' ')
        && !s.contains('\t')
        && !s.contains('&')
        && !s.contains('^')
        && !s.contains('"')
    {
        return s.to_string();
    }
    format!("\"{}\"", s.replace('"', r#"\""#))
}

#[cfg(windows)]
fn spawn_windows_cmd_script(script_path_str: &str) -> Result<(), String> {
    let cwd = cwd_parent(Path::new(script_path_str));

    match std::process::Command::new("cmd.exe")
        .current_dir(&cwd)
        .arg("/C")
        .arg(script_path_str)
        .spawn()
    {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) => {
            cmd_shell_elevated(script_path_str, &cwd)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn cmd_shell_elevated(script_path_str: &str, cwd: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let comspec: PathBuf = std::env::var_os("COMSPEC")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe"));

    let exe_w: Vec<u16> = comspec.as_os_str().encode_wide().chain(Some(0)).collect();

    let params = format!("/C {}", shell_escape_windows_arg(script_path_str));
    let params_w: Vec<u16> = OsStr::new(params.as_str())
        .encode_wide()
        .chain(Some(0))
        .collect();
    let dir_w: Vec<u16> = cwd.as_os_str().encode_wide().chain(Some(0)).collect();

    unsafe {
        let runas: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
        let h = ShellExecuteW(
            ptr::null_mut(),
            runas.as_ptr(),
            exe_w.as_ptr(),
            params_w.as_ptr(),
            dir_w.as_ptr(),
            SW_SHOWNORMAL,
        );
        if (h as isize) <= 32 {
            Err(format!("No se elevó cmd para el script ({}).", h as isize))
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
fn spawn_unix_shell_script(script_path_str: &str) -> Result<(), String> {
    let p = Path::new(script_path_str);
    let cwd = cwd_parent(p);
    std::process::Command::new("sh")
        .arg(script_path_str)
        .current_dir(&cwd)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("sh <script>: {e}"))
}

fn spawn_native_executable(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_launch_exe(path)
    }
    #[cfg(not(windows))]
    {
        let mut cmd = std::process::Command::new(path);
        if let Some(dir) = Path::new(path).parent() {
            cmd.current_dir(dir);
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn windows_launch_exe(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe_dir = Path::new(path).parent();

    let mut cmd = std::process::Command::new(path);
    if let Some(dir) = exe_dir {
        cmd.current_dir(dir);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) => unsafe {
            let path_w: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
            let runas: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
            let dir_w: Option<Vec<u16>> =
                exe_dir.map(|d| d.as_os_str().encode_wide().chain(Some(0)).collect());
            let dir_ptr = dir_w.as_ref().map(|v| v.as_ptr()).unwrap_or(ptr::null());
            let h = ShellExecuteW(
                std::ptr::null_mut(),
                runas.as_ptr(),
                path_w.as_ptr(),
                ptr::null(),
                dir_ptr,
                SW_SHOWNORMAL,
            );
            if (h as isize) <= 32 {
                Err(format!(
                    "No se pudo solicitar elevación para el ejecutable (código {}).",
                    h as isize
                ))
            } else {
                Ok(())
            }
        },
        Err(e) => Err(e.to_string()),
    }
}
