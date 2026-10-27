//! Operaciones de entrada/salida a disco para descargas HTTP.
//!
//! Proporciona escritura concurrente sin locks mediante APIs nativas de cada sistema
//! operativo y renombrado atómico tolerante a bloqueos transitorios de Windows Defender.

use std::path::Path;
use std::time::Duration;

/// Escribe JSON en un archivo lateral y lo publica con un renombrado al finalizar.
pub async fn write_json_atomically<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
) -> Result<(), std::io::Error> {
    let bytes = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("checkpoint");
    let temporary_path = path.with_file_name(format!("{file_name}.tmp-{}", uuid::Uuid::new_v4()));

    tokio::fs::write(&temporary_path, bytes).await?;
    if let Err(error) = tokio::fs::rename(&temporary_path, path).await {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    Ok(())
}

/// Escribe un buffer en un offset arbitrario de un archivo existente.
///
/// En Windows utiliza `FileExt::seek_write`, que mapea a la función Win32 `WriteFile`
/// con una estructura `OVERLAPPED`. Esto permite que múltiples hilos concurrentes
/// escriban en diferentes segmentos del mismo archivo sin contención ni necesidad
/// de sincronización manual con mutexes.
///
/// En sistemas Unix utiliza `FileExt::write_all_at` (`pwrite`).
pub fn write_at(file: &std::fs::File, buf: &[u8], offset: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let (mut buf, mut offset) = (buf, offset);
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
/// 1. Conserva el archivo de destino existente en una copia temporal recuperable.
/// 2. Aplica un bucle de hasta 10 reintentos con retraso incremental (150ms * intento)
///    para permitir que el kernel o el antivirus liberen el archivo antes de fallar.
/// 3. Restaura la copia anterior si no se puede instalar el archivo nuevo.
pub async fn safe_rename_with_retry(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    let backup_path = to.with_file_name(format!(
        "{}.savecloud-{}-backup",
        to.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("download"),
        uuid::Uuid::new_v4()
    ));
    let has_previous_file = match tokio::fs::metadata(to).await {
        Ok(_) => {
            tokio::fs::rename(to, &backup_path).await?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error),
    };

    let mut last_err = None;

    for attempt in 0..10 {
        match tokio::fs::rename(from, to).await {
            Ok(()) => {
                if has_previous_file {
                    let _ = tokio::fs::remove_file(&backup_path).await;
                }
                return Ok(());
            }
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_millis(150 * (attempt + 1))).await;
            }
        }
    }

    if has_previous_file {
        if let Err(restore_error) = tokio::fs::rename(&backup_path, to).await {
            return Err(std::io::Error::other(format!(
                "No se pudo instalar el nuevo archivo ni restaurar el anterior desde {}: {restore_error}",
                backup_path.display()
            )));
        }
    }

    Err(last_err.unwrap_or_else(|| std::io::Error::other("Fallo desconocido al renombrar archivo")))
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
        assert!(
            elapsed < Duration::from_millis(500),
            "Asignación tardó demasiado: {elapsed:?}"
        );

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
