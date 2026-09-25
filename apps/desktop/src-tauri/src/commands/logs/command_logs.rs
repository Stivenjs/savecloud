use crate::plugins::log_buffer::{AppLogs, LogEntry};

#[tauri::command]
pub async fn get_plugin_logs(logs: tauri::State<'_, AppLogs>) -> Result<Vec<LogEntry>, String> {
    Ok(logs.lock().await.all())
}
