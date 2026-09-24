//! Utilidades para gestión y optimización de memoria del proceso (Multiplataforma).

/// Solicita al sistema operativo la liberación de páginas de memoria física no utilizadas
/// en el Working Set / Heap del proceso actual.
///
/// ### Comportamiento por plataforma:
/// - **Windows**: Invoca `SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX)`
///   para instruir al kernel a podar (trim) páginas inactivas hacia la reserva del sistema,
///   reduciendo de inmediato el consumo de memoria física en el Administrador de Tareas.
/// - **Linux**: Invoca `libc::malloc_trim(0)` para liberar bloques del heap asignados pero no
///   utilizados de vuelta al kernel.
/// - **macOS / Otros**: No-op (gestionado automáticamente por el kernel / App Nap).
pub fn trim_working_set() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};
        let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
    }

    #[cfg(target_os = "linux")]
    unsafe {
        libc::malloc_trim(0);
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        // En macOS y otras plataformas el runtime / App Nap administra el working set.
    }
}
