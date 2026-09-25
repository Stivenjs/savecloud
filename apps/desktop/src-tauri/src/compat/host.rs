use sysinfo::System;

use crate::compat::gpu;
use crate::compat::types::HostSpecs;

pub fn collect_host_specs() -> HostSpecs {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_memory_mb = sys.total_memory() / 1024 / 1024;
    let cpu_logical_cores = sys.cpus().len() as u32;
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();

    let os_label = System::long_os_version()
        .or_else(System::name)
        .unwrap_or_else(|| "unknown".to_string());

    HostSpecs {
        total_memory_mb,
        cpu_logical_cores,
        cpu_brand,
        os_label,
        gpu_name: gpu::primary_gpu_name(),
    }
}
