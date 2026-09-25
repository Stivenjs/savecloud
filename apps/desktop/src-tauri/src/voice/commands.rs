use std::sync::mpsc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait};
use ringbuf::{traits::Split, HeapRb};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

use crate::config;

use super::{audio, matcher, wake_word, VoiceError, VoiceState};

#[derive(serde::Serialize)]
pub struct GameMatch {
    pub game_id: String,
    pub name: String,
    pub score: f32,
}

#[tauri::command]
pub fn start_voice_listener(
    app: AppHandle,
    state: State<'_, VoiceState>,
) -> Result<(), VoiceError> {
    if state
        .inner()
        .detector_thread
        .lock()
        .map_err(|_| VoiceError::StatePoisoned)?
        .is_some()
    {
        return Err(VoiceError::AlreadyRunning);
    }

    let model_path = app
        .path()
        .resolve("resources/oye_cloud.rpw", BaseDirectory::Resource)
        .map_err(|e| VoiceError::ResourceNotFound(e.to_string()))?;
    if !model_path.is_file() {
        return Err(VoiceError::ResourceNotFound(
            model_path.display().to_string(),
        ));
    }

    let stop = tokio_util::sync::CancellationToken::new();
    let stop_clone = stop.clone();
    let app_handle = app.clone();
    let (startup_tx, startup_rx) = mpsc::channel::<Result<(), String>>();

    let thread_handle = std::thread::spawn(move || {
        let rb = HeapRb::<i16>::new(16_000);
        let (producer, consumer) = rb.split();
        let stream = audio::build_input_stream(producer);
        match stream {
            Ok(_stream) => {
                let _ = startup_tx.send(Ok(()));
                if let Err(e) =
                    wake_word::run_detection_loop(app_handle, consumer, model_path, stop_clone)
                {
                    log::warn!("[Voice] detector stopped with error: {}", e);
                }
            }
            Err(e) => {
                let err_message = match &e {
                    VoiceError::Cpal(msg) => msg.clone(),
                    _ => e.to_string(),
                };
                let _ = startup_tx.send(Err(err_message));
                log::warn!("[Voice] no se pudo iniciar el stream de audio: {}", e);
            }
        }
    });

    match startup_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            let _ = thread_handle.join();
            return Err(VoiceError::Cpal(err));
        }
        Err(_) => {
            let _ = thread_handle.join();
            return Err(VoiceError::Cpal(
                "Timeout inicializando el micrófono (revisa permisos/dispositivo)".to_string(),
            ));
        }
    }

    {
        let mut token_lock = state
            .inner()
            .stop_token
            .lock()
            .map_err(|_| VoiceError::StatePoisoned)?;
        *token_lock = Some(stop);
    }
    {
        let mut thread_lock = state
            .inner()
            .detector_thread
            .lock()
            .map_err(|_| VoiceError::StatePoisoned)?;
        *thread_lock = Some(thread_handle);
    }

    Ok(())
}

#[tauri::command]
pub fn stop_voice_listener(state: State<'_, VoiceState>) -> Result<(), VoiceError> {
    if let Some(token) = state
        .inner()
        .stop_token
        .lock()
        .map_err(|_| VoiceError::StatePoisoned)?
        .take()
    {
        token.cancel();
    }

    if let Some(thread) = state
        .inner()
        .detector_thread
        .lock()
        .map_err(|_| VoiceError::StatePoisoned)?
        .take()
    {
        let _ = thread.join();
    }

    Ok(())
}

#[tauri::command]
pub fn find_game_by_voice_query(text: String) -> Result<Option<GameMatch>, String> {
    let library = config::load_library();
    Ok(
        matcher::find_best_match(&text, &library).map(|m| GameMatch {
            game_id: m.game_id,
            name: m.name,
            score: m.score,
        }),
    )
}

#[tauri::command]
pub fn find_game_voice_candidates(
    text: String,
    limit: Option<usize>,
) -> Result<Vec<GameMatch>, String> {
    let library = config::load_library();
    let max = limit.unwrap_or(3).min(5);
    Ok(matcher::find_top_matches(&text, &library, max)
        .into_iter()
        .map(|m| GameMatch {
            game_id: m.game_id,
            name: m.name,
            score: m.score,
        })
        .collect())
}

#[tauri::command]
pub fn emit_test_wake_word(app: AppHandle) -> Result<(), VoiceError> {
    app.emit("voice://wake-word-detected", "manual_test")
        .map_err(|e| VoiceError::Cpal(e.to_string()))
}

#[tauri::command]
pub fn list_voice_input_devices() -> Result<Vec<String>, VoiceError> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| VoiceError::Cpal(e.to_string()))?;
    let names = devices
        .map(|d| {
            d.name()
                .unwrap_or_else(|_| "Dispositivo sin nombre".to_string())
        })
        .collect::<Vec<_>>();
    Ok(names)
}
