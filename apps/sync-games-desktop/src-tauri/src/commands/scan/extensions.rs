use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize, Debug)]
pub struct ExtensionConfig {
    pub strong_save_extensions: Vec<String>,
    pub weak_save_extensions: Vec<String>,
    pub save_folder_names: Vec<String>,
    pub save_name_hints: Vec<String>,
}

pub fn get_ext_config() -> &'static ExtensionConfig {
    static CONFIG: OnceLock<ExtensionConfig> = OnceLock::new();

    CONFIG.get_or_init(|| {
        let json_data = include_str!("data/extensions.json");
        serde_json::from_str(json_data).expect("Error al parsear extensions.json")
    })
}

pub fn strong_save_extensions() -> &'static [String] {
    &get_ext_config().strong_save_extensions
}

pub fn weak_save_extensions() -> &'static [String] {
    &get_ext_config().weak_save_extensions
}

pub fn save_folder_names() -> &'static [String] {
    &get_ext_config().save_folder_names
}

pub fn save_name_hints() -> &'static [String] {
    &get_ext_config().save_name_hints
}
