#[cfg(windows)]
pub fn primary_gpu_name() -> Option<String> {
    use std::collections::HashSet;

    let mut names: Vec<String> = wmi_video_controller_names()
        .unwrap_or_default();
    names.extend(registry_display_driver_descs());

    let mut seen: HashSet<String> = HashSet::new();
    names.retain(|n| {
        let k = n.trim().to_lowercase();
        if k.is_empty() {
            return false;
        }
        seen.insert(k)
    });

    pick_best_display_name(names)
}

#[cfg(windows)]
fn is_placeholder_adapter(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("microsoft basic display")
        || n.contains("microsoft basic render")
        || n.contains("microsoft remote display")
        || n.contains("parsecd virtual display")
        || (n.contains("microsoft") && n.contains("render driver") && n.contains("basic"))
}

#[cfg(windows)]
fn score_display_name(name: &str) -> u32 {
    let n = name.to_lowercase();
    let mut s: u32 = 0;
    if n.contains("nvidia") || n.contains("geforce") || n.contains("rtx") || n.contains("gtx") {
        s += 8;
    }
    if n.contains("radeon") || n.contains("amd") {
        s += 8;
    }
    if n.contains("intel") && (n.contains("arc") || n.contains("iris") || n.contains("uhd")) {
        s += 6;
    }
    if n.contains("graphics") || n.contains("gráficos") {
        s += 2;
    }
    s.saturating_add(name.len() as u32)
}

#[cfg(windows)]
fn pick_best_display_name(mut names: Vec<String>) -> Option<String> {
    names.retain(|n| !is_placeholder_adapter(n));
    if names.is_empty() {
        return None;
    }
    names.sort_by(|a, b| {
        score_display_name(b)
            .cmp(&score_display_name(a))
            .then_with(|| b.len().cmp(&a.len()))
    });
    names.into_iter().next()
}

#[cfg(windows)]
fn wmi_video_controller_names() -> Option<Vec<String>> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let com = COMLibrary::new().ok()?;
    let conn = WMIConnection::new(com).ok()?;
    let rows: Vec<HashMap<String, Variant>> = conn
        .raw_query("SELECT Name FROM Win32_VideoController")
        .ok()?;

    let mut out = Vec::new();
    for row in rows {
        if let Some(Variant::String(s)) = row.get("Name") {
            if !s.trim().is_empty() {
                out.push(s.clone());
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[cfg(windows)]
fn registry_display_driver_descs() -> Vec<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const CLASS: &str = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let key = match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(CLASS) {
        Ok(k) => k,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    for sub in key.enum_keys().filter_map(std::result::Result::ok) {
        if sub == "Configuration" || sub == "Properties" {
            continue;
        }
        let Ok(subkey) = key.open_subkey(&sub) else {
            continue;
        };
        if let Ok(desc) = subkey.get_value::<String, _>("DriverDesc") {
            let desc = desc.trim();
            if !desc.is_empty() {
                out.push(desc.to_string());
            }
        }
    }
    out
}

#[cfg(not(windows))]
pub fn primary_gpu_name() -> Option<String> {
    None
}
