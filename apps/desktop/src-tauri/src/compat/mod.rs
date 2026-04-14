mod compare;
mod gpu;
mod gpu_compat;
mod host;
mod parse;
mod types;

pub use types::{HostSpecs, RunCompatibilityReport};

use compare::build_report;
use host::collect_host_specs;
use parse::parse_requirements_html;

#[tauri::command]
pub fn evaluate_run_compatibility(
    pc_requirements_minimum: Option<String>,
    pc_requirements_recommended: Option<String>,
) -> Result<RunCompatibilityReport, String> {
    let host = collect_host_specs();
    let minimum = parse_requirements_html(pc_requirements_minimum.as_deref());
    let recommended = parse_requirements_html(pc_requirements_recommended.as_deref());
    Ok(build_report(host, minimum, recommended))
}

#[tauri::command]
pub fn get_host_specs() -> Result<HostSpecs, String> {
    Ok(collect_host_specs())
}
