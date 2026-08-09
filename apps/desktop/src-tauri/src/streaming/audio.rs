//! Subsistema de Audio: Decodifica Opus a PCM y reenvía al Frontend vía WebSocket.
//!
//! Moonlight-common-c entrega datos Opus comprimidos en `decodeAndPlaySample`.
//! Este módulo los decodifica con `opus-decoder` (pure Rust) a PCM 16-bit 48kHz stereo,
//! y los transmite con encabezado tipo `2` por WebSocket hacia WebAudio API en React.

use super::bindings::VIDEO_CHANNEL;
use once_cell::sync::Lazy;
use opus_decoder::OpusDecoder;
use std::os::raw::{c_char, c_int, c_void};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Debug)]
struct AudioDevice {
    name: String,
    is_active: bool,
}

/// Detecta el mejor dispositivo de audio activo en el sistema Windows para Sunshine Host.
pub fn detect_best_active_sink(sunshine_bin_dir: &Path) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let audio_info_path = sunshine_bin_dir.join("tools").join("audio-info.exe");
        if !audio_info_path.exists() {
            return None;
        }

        let mut cmd = Command::new(&audio_info_path);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut devices = Vec::new();
        let mut current_dev = AudioDevice {
            name: String::new(),
            is_active: false,
        };

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Device name") {
                if let Some(val) = trimmed.split(':').nth(1) {
                    current_dev.name = val.trim().to_string();
                }
            } else if trimmed.starts_with("Device state") {
                if trimmed.contains("Active") {
                    current_dev.is_active = true;
                }
            } else if (trimmed.starts_with("===== Device =====")
                || trimmed.starts_with("====== Found"))
                && !current_dev.name.is_empty()
            {
                devices.push(current_dev);
                current_dev = AudioDevice {
                    name: String::new(),
                    is_active: false,
                };
            }
        }
        if !current_dev.name.is_empty() {
            devices.push(current_dev);
        }

        let best = devices.iter().find(|d| {
            d.is_active
                && (d.name.contains("Speakers")
                    || d.name.contains("Altavoces")
                    || d.name.contains("Auriculares")
                    || d.name.contains("Realtek")
                    || d.name.contains("FxSound"))
        });

        if let Some(dev) = best {
            Some(dev.name.clone())
        } else {
            devices.iter().find(|d| d.is_active).map(|d| d.name.clone())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = sunshine_bin_dir;
        None
    }
}

// Decodificador Opus global (thread-safe)

static OPUS_DECODER: Lazy<Mutex<Option<OpusDecoder>>> = Lazy::new(|| Mutex::new(None));
static AUDIO_FRAME_COUNT: AtomicU64 = AtomicU64::new(0);

// Callbacks FFI de Audio
pub unsafe extern "C" fn ar_init(
    _audio_configuration: c_int,
    _opus_config: *const c_void,
    _context: *mut c_void,
    _ar_flags: c_int,
) -> c_int {
    log::info!("Moonlight Audio: Init - Creando decodificador Opus (48kHz stereo)");

    match OpusDecoder::new(48000, 2) {
        Ok(dec) => {
            if let Ok(mut guard) = OPUS_DECODER.lock() {
                *guard = Some(dec);
            }
            log::info!("Moonlight Audio: Decodificador Opus creado exitosamente");
            0
        }
        Err(e) => {
            log::error!("Moonlight Audio: Error creando decodificador Opus: {:?}", e);
            -1
        }
    }
}

pub unsafe extern "C" fn ar_start() {
    log::info!("Moonlight Audio: Start - Decodificando Opus a PCM y reenviando al Frontend...");
}

pub unsafe extern "C" fn ar_stop() {
    log::info!("Moonlight Audio: Stop");
}

pub unsafe extern "C" fn ar_cleanup() {
    log::info!("Moonlight Audio: Cleanup");
    if let Ok(mut guard) = OPUS_DECODER.lock() {
        *guard = None;
    }
}

pub unsafe extern "C" fn ar_decode_and_play_sample(sample_data: *mut c_char, sample_length: c_int) {
    if sample_data.is_null() || sample_length <= 0 {
        return;
    }

    let count = AUDIO_FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
    let opus_data = std::slice::from_raw_parts(sample_data as *const u8, sample_length as usize);

    let mut pcm_output = vec![0i16; 11520];

    let decoded_samples = {
        if let Ok(mut guard) = OPUS_DECODER.lock() {
            if let Some(decoder) = guard.as_mut() {
                match decoder.decode(opus_data, &mut pcm_output, false) {
                    Ok(samples_per_channel) => samples_per_channel,
                    Err(e) => {
                        if count < 5 {
                            log::warn!(
                                "[Audio] Error decodificando Opus trama #{}: {:?}",
                                count,
                                e
                            );
                        }
                        return;
                    }
                }
            } else {
                return;
            }
        } else {
            return;
        }
    };

    let total_samples = decoded_samples * 2;
    let pcm_bytes: &[u8] =
        std::slice::from_raw_parts(pcm_output.as_ptr() as *const u8, total_samples * 2);

    if count < 10 {
        let first_samples: Vec<i16> = pcm_output.iter().take(8).copied().collect();
        log::info!(
            "[Audio] DECODED trama #{}: {} bytes Opus -> {} muestras PCM por canal, primeras={:?}",
            count,
            sample_length,
            decoded_samples,
            first_samples,
        );
    } else if count % 500 == 0 {
        log::info!(
            "[Audio] Trama #{} (Opus: {} bytes -> PCM: {} muestras)",
            count,
            sample_length,
            total_samples
        );
    }

    let mut payload = Vec::with_capacity(1 + pcm_bytes.len());
    payload.push(2);
    payload.extend_from_slice(pcm_bytes);

    if let Ok(guard) = VIDEO_CHANNEL.lock() {
        if let Some(sender) = guard.as_ref() {
            let _ = sender.try_send(payload);
        }
    }
}
