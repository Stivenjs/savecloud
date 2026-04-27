use super::{
    DEFAULT_PRE_UPLOAD_TIMEOUT_MS, MAX_PRE_UPLOAD_TIMEOUT_MS, MIN_PRE_UPLOAD_TIMEOUT_MS,
    SUPPORTED_PLUGIN_API_VERSION,
};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub hooks: PluginHooks,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PluginHooks {
    pub on_pre_upload_timeout_ms: Option<u64>,
}

fn default_enabled() -> bool {
    true
}

impl PluginManifest {
    pub fn is_api_version_compatible(&self) -> bool {
        self.api_version == SUPPORTED_PLUGIN_API_VERSION
    }

    pub fn resolved_pre_upload_timeout_ms(&self) -> u64 {
        clamp_pre_upload_timeout_ms(self.hooks.on_pre_upload_timeout_ms)
    }
}

pub fn clamp_pre_upload_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    let raw = timeout_ms.unwrap_or(DEFAULT_PRE_UPLOAD_TIMEOUT_MS);
    raw.clamp(MIN_PRE_UPLOAD_TIMEOUT_MS, MAX_PRE_UPLOAD_TIMEOUT_MS)
}

pub fn load_manifest_from_dir(dir_path: &Path) -> Result<PluginManifest, String> {
    let manifest_path = dir_path.join("plugin.json");
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| {
        format!(
            "manifest_missing path={} error={e}",
            manifest_path.display()
        )
    })?;
    serde_json::from_str::<PluginManifest>(&raw).map_err(|e| {
        format!(
            "manifest_invalid path={} error={e}",
            manifest_path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_clamps_to_bounds() {
        assert_eq!(
            clamp_pre_upload_timeout_ms(None),
            DEFAULT_PRE_UPLOAD_TIMEOUT_MS
        );
        assert_eq!(
            clamp_pre_upload_timeout_ms(Some(100)),
            MIN_PRE_UPLOAD_TIMEOUT_MS
        );
        assert_eq!(
            clamp_pre_upload_timeout_ms(Some(50_000)),
            MAX_PRE_UPLOAD_TIMEOUT_MS
        );
        assert_eq!(clamp_pre_upload_timeout_ms(Some(4_000)), 4_000);
    }

    #[test]
    fn enabled_defaults_true_when_omitted() {
        let json = r#"{
            "id":"sample.plugin",
            "name":"Sample",
            "version":"1.0.0",
            "api_version":1
        }"#;
        let parsed = serde_json::from_str::<PluginManifest>(json).expect("valid manifest");
        assert!(parsed.enabled);
    }
}
