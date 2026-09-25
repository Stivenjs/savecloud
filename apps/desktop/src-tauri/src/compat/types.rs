use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSpecs {
    pub total_memory_mb: u64,
    pub cpu_logical_cores: u32,
    pub cpu_brand: String,
    pub os_label: String,
    pub gpu_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRequirements {
    pub ram_mb: Option<u64>,
    pub storage_gb: Option<u64>,
    pub directx: Option<u32>,
    /// Texto tras Gráficos:/Graphics: (alternativas separadas por `/`).
    #[serde(default)]
    pub gpu_text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FactorStatus {
    Pass,
    Fail,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityFactor {
    pub id: String,
    pub status: FactorStatus,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompatibilityLevel {
    Likely,
    Uncertain,
    Unlikely,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCompatibilityReport {
    pub overall: CompatibilityLevel,
    pub host: HostSpecs,
    pub minimum: ParsedRequirements,
    pub recommended: ParsedRequirements,
    pub factors: Vec<CompatibilityFactor>,
}
