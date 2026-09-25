//! Módulo para el buffer de logs de plugins en memoria.
//!
//! Los logs se limpian automáticamente al cerrar la app
//! ya que viven únicamente en memoria.

use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub plugin: String,
    pub message: String,
}

pub struct LogBuffer {
    entries: VecDeque<LogEntry>,
    max_size: usize,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            max_size: 1000,
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= self.max_size {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn all(&self) -> Vec<LogEntry> {
        self.entries.iter().cloned().collect()
    }
}

pub type AppLogs = Arc<Mutex<LogBuffer>>;

pub fn new_log_buffer() -> AppLogs {
    Arc::new(Mutex::new(LogBuffer::new()))
}