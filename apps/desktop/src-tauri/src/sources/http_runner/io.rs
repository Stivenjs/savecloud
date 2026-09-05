//! Operaciones de entrada/salida a disco para descargas HTTP.
//!
//! Proporciona escritura concurrente sin locks mediante APIs nativas de cada sistema
//! operativo y renombrado atómico tolerante a bloqueos transitorios de Windows Defender.

use std::path::Path;
use std::time::Duration;

/// Escribe un buffer en un offset arbitrario de un archivo existente.
///
/// En Windows utiliza `FileExt::seek_write`, que mapea a la función Win32 `WriteFile`
/// con una estructura `OVERLAPPED`. Esto permite que múltiples hilos concurrentes
/// escriban en diferentes segmentos del mismo archivo sin contención ni necesidad
/// de sincronización manual con mutexes.
///
/// En sistemas Unix utiliza `FileExt::write_all_at` (`pwrite`).
pub fn write_at(file: &std::fs::File, mut buf: &[u8], mut offset: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        while !buf.is_empty() {
            let written = file.seek_write(buf, offset)?;
            if written == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "falló la escritura en archivo (0 bytes escritos)",
                ));
            }
            buf = &buf[written..];
            offset += written as u64;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)
    }
}

#[cfg(windows)]
/// Habilita el atributo de archivo sparse (disperso) en sistemas de archivos NTFS.
pub fn make_file_sparse(file: &std::fs::File) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;

    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            hDevice: *mut std::ffi::c_void,
            dwIoControlCode: u32,
            lpInBuffer: *mut std::ffi::c_void,
            nInBufferSize: u32,
            lpOutBuffer: *mut std::ffi::c_void,
            nOutBufferSize: u32,
            lpBytesReturned: *mut u32,
            lpOverlapped: *mut std::ffi::c_void,
        ) -> i32;
    }

    const FSCTL_SET_SPARSE: u32 = 0x000900C4;
    let mut bytes_returned: u32 = 0;
    let handle = file.as_raw_handle();

    let success = unsafe {
        DeviceIoControl(
            handle as *mut std::ffi::c_void,
            FSCTL_SET_SPARSE,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if success == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Prepara un archivo para descargas multi-segmento sin bloquear el sistema ni congelar la UI.
///
/// En Windows NTFS, llamar a `set_len(total)` sobre un archivo convencional obliga al kernel
/// a rellenar síncronamente ceros en disco (a velocidad de disco, tardando hasta 1 minuto
/// en archivos de 10 GB), provocando que la interfaz se quede en "Descargando" sin avanzar.
///
/// Al activar el atributo sparse (`FSCTL_SET_SPARSE`), `set_len` se convierte en una
/// actualización de metadatos instantánea (< 1 ms), arrancando la descarga de red al instante
/// sin pre-asignación lenta ni desgaste innecesario del almacenamiento.
pub fn allocate_file_fast(file: &std::fs::File, total: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        // En NTFS sparse, set_len es instantáneo (0ms).
        // Si el volumen no soporta sparse (ej. exFAT), omitimos set_len para evitar congelar la UI.
        if make_file_sparse(file).is_ok() {
            let _ = file.set_len(total);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = file.set_len(total);
        Ok(())
    }
}

/// Renombra un archivo temporal `.part` a su destino final de forma segura.
///
/// En Windows, los antivirus (como Windows Defender) o la liberación asíncrona de
/// handles en el thread pool de Tokio pueden retener brevemente un bloqueo sobre
/// el archivo inmediatamente después de cerrarse (`ERROR_SHARING_VIOLATION`).
///
/// Esta función:
/// 1. Elimina previamente el archivo de destino si ya existía.
/// 2. Aplica un bucle de hasta 10 reintentos con retraso incremental (150ms * intento)
///    para permitir que el kernel o el antivirus liberen el archivo antes de fallar.
pub async fn safe_rename_with_retry(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    let _ = tokio::fs::remove_file(to).await;
    let mut last_err = None;

    for attempt in 0..10 {
        match tokio::fs::rename(from, to).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                let _ = tokio::fs::remove_file(to).await;
                tokio::time::sleep(Duration::from_millis(150 * (attempt + 1))).await;
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        std::io::Error::other(
            "Fallo desconocido al renombrar archivo",
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn safe_rename_renames_file_correctly() {
        let temp_dir = std::env::temp_dir().join(format!("sc_test_io_{}", std::process::id()));
        let _ = tokio::fs::create_dir_all(&temp_dir).await;

        let src = temp_dir.join("test.part");
        let dst = temp_dir.join("test.final");

        tokio::fs::write(&src, b"data").await.unwrap();
        safe_rename_with_retry(&src, &dst).await.unwrap();

        assert!(!src.exists());
        assert!(dst.exists());

        let content = tokio::fs::read(&dst).await.unwrap();
        assert_eq!(content, b"data");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn allocate_file_fast_is_instantaneous() {
        let temp_dir = std::env::temp_dir().join(format!("sc_test_sparse_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let file_path = temp_dir.join("fast_alloc.part");

        let file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&file_path)
            .unwrap();

        let start = std::time::Instant::now();
        // 10 Gigabytes
        let ten_gb = 10 * 1024 * 1024 * 1024;
        allocate_file_fast(&file, ten_gb).unwrap();
        let elapsed = start.elapsed();

        // En lugar de tardar 30-60 segundos rellenando ceros, debe tardar menos de 500ms
        assert!(elapsed < Duration::from_millis(500), "Asignación tardó demasiado: {elapsed:?}");

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
