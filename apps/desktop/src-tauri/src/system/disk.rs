use serde::Serialize;
use sysinfo::Disks;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount_point: String,
    pub name: String,
    pub available_space: u64,
    pub total_space: u64,
    pub is_removable: bool,
}

#[tauri::command]
pub async fn get_available_disks() -> Result<Vec<DiskInfo>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut result = Vec::new();

    for disk in &disks {
        result.push(DiskInfo {
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            name: disk.name().to_string_lossy().to_string(),
            available_space: disk.available_space(),
            total_space: disk.total_space(),
            is_removable: disk.is_removable(),
        });
    }

    Ok(result)
}
