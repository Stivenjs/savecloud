//! Lanzamiento de ejecutables de juegos. En Windows, si el proceso exige permisos de administrador,
//! `CreateProcess` falla con ERROR_ELEVATION_REQUIRED (740); en ese caso se usa `ShellExecuteW` con el verbo `runas`
//! para mostrar el diálogo UAC.
//!
//! El directorio de trabajo se fija en la carpeta del `.exe`. Si no se hace, el hijo hereda el CWD de SaveCloud
//! y muchos juegos fallan o quedan en pantalla negra (recursos y DLLs con rutas relativas).

#[cfg(windows)]
const ERROR_ELEVATION_REQUIRED: i32 = 740;

/// Inicia un ejecutable por ruta absoluta. En Windows reintenta con elevación (UAC) si hace falta.
pub fn launch_game_executable(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_launch(path)
    }
    #[cfg(not(windows))]
    {
        let mut cmd = std::process::Command::new(path);
        if let Some(dir) = std::path::Path::new(path).parent() {
            cmd.current_dir(dir);
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn windows_launch(path: &str) -> Result<(), String> {
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
                SW_SHOWNORMAL as i32,
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
