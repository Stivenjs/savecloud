pub mod audio;
pub mod commands;
pub mod error;
pub mod matcher;
pub mod wake_word;

pub use error::VoiceError;

use std::sync::Mutex;
use std::thread::JoinHandle;

use tokio_util::sync::CancellationToken;

pub const WAKE_WORD_EVENT: &str = "voice://wake-word-detected";

#[derive(Default)]
pub struct VoiceState {
    pub stop_token: Mutex<Option<CancellationToken>>,
    pub detector_thread: Mutex<Option<JoinHandle<()>>>,
}
