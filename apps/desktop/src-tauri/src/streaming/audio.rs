//! Subsistema de Audio Nativo (CPAL + libopus)

use std::os::raw::{c_char, c_int, c_void};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use once_cell::sync::Lazy;
use opus::{Channels, Decoder as OpusDecoder};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};

/// Tamaño máximo de muestras PCM por trama de decodificación (60ms estéreo a 48kHz).
const MAX_FRAME_SAMPLES: usize = 5760;
/// Frecuencia de muestreo por defecto (48kHz).
const DEFAULT_SAMPLE_RATE: u32 = 48000;
/// Cantidad de canales por defecto (Estéreo = 2).
const DEFAULT_CHANNELS: u16 = 2;
/// Capacidad del buffer circular nativo (1 segundo de muestras i16 estéreo).
const RING_BUFFER_CAPACITY: usize = 96000;
/// Muestras mínimas en el buffer circular antes de iniciar reproducción (~30ms a 48kHz estéreo).
const PREBUFFER_MIN_SAMPLES: usize = 2880;

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

/// Configuración de Opus Multistream recibida desde Moonlight-common-c en `ar_init`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct OpusMultistreamConfig {
    pub sample_rate: c_int,
    pub channel_count: c_int,
    pub streams: c_int,
    pub coupled_streams: c_int,
    pub samples_per_frame: c_int,
    pub mapping: [u8; 8],
}

/// Estado interno de los decodificadores Opus y el productor del RingBuffer para CPAL.
struct AudioStreamState {
    stereo_decoder: OpusDecoder,
    mono_decoder: OpusDecoder,
    producer: Option<HeapProd<i16>>,
    sample_rate: u32,
    channels: u16,
}

/// Reproductor de audio nativo CPAL. Mantiene activo el stream de hardware.
struct NativeAudioPlayer {
    _stream: cpal::Stream,
}

unsafe impl Send for NativeAudioPlayer {}
unsafe impl Sync for NativeAudioPlayer {}

static AUDIO_STATE: Lazy<Mutex<Option<AudioStreamState>>> = Lazy::new(|| Mutex::new(None));
static NATIVE_PLAYER: Lazy<Mutex<Option<NativeAudioPlayer>>> = Lazy::new(|| Mutex::new(None));
static AUDIO_FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
static IS_PLAYING: AtomicBool = AtomicBool::new(false);
static PREBUFFER_READY: AtomicBool = AtomicBool::new(false);

/// Inicializa el reproductor de audio nativo CPAL para la plataforma actual.
fn init_cpal_player(sample_rate: u32, channels: u16) -> Option<(cpal::Stream, HeapProd<i16>)> {
    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(d) => d,
        None => {
            log::warn!(
                "[Audio] No se encontró dispositivo de salida de audio nativo predeterminado"
            );
            return None;
        }
    };

    let config = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            log::warn!(
                "[Audio] Configuración predeterminada de dispositivo CPAL no válida: {:?}",
                e
            );
            return None;
        }
    };

    let ring_buffer = HeapRb::<i16>::new(RING_BUFFER_CAPACITY);
    let (producer, mut consumer): (HeapProd<i16>, HeapCons<i16>) = ring_buffer.split();

    let sample_format = config.sample_format();
    let mut stream_config: cpal::StreamConfig = config.into();
    stream_config.sample_rate = cpal::SampleRate(sample_rate);

    let target_channels = stream_config.channels as usize;
    let err_fn = |err| log::error!("[Audio] Error en stream nativo CPAL: {:?}", err);

    let stream_result = match sample_format {
        cpal::SampleFormat::F32 => device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                process_cpal_f32(data, target_channels, channels, &mut consumer)
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_output_stream(
            &stream_config,
            move |data: &mut [i16], _| {
                process_cpal_i16(data, target_channels, channels, &mut consumer)
            },
            err_fn,
            None,
        ),
        unsupported => {
            log::warn!(
                "[Audio] Formato de muestra de hardware no soportado: {:?}",
                unsupported
            );
            return None;
        }
    };

    match stream_result {
        Ok(stream) => {
            if let Err(e) = stream.play() {
                log::warn!("[Audio] No se pudo iniciar el stream CPAL: {:?}", e);
            } else {
                log::info!(
                    "[Audio] Stream nativo CPAL iniciado ({:?}, {} Hz, {} canales)",
                    sample_format,
                    stream_config.sample_rate.0,
                    stream_config.channels
                );
            }
            Some((stream, producer))
        }
        Err(e) => {
            log::warn!("[Audio] Error creando stream CPAL: {:?}", e);
            None
        }
    }
}

/// Procesa las muestras float32 para la salida CPAL utilizando Jitter Pre-Buffering.
#[inline]
fn process_cpal_f32(
    data: &mut [f32],
    target_channels: usize,
    channels: u16,
    consumer: &mut HeapCons<i16>,
) {
    if !IS_PLAYING.load(Ordering::Relaxed) {
        data.fill(0.0);
        return;
    }

    if !PREBUFFER_READY.load(Ordering::Relaxed) {
        if consumer.occupied_len() >= PREBUFFER_MIN_SAMPLES {
            PREBUFFER_READY.store(true, Ordering::Relaxed);
        } else {
            data.fill(0.0);
            return;
        }
    }

    if consumer.occupied_len() == 0 {
        PREBUFFER_READY.store(false, Ordering::Relaxed);
        data.fill(0.0);
        return;
    }

    for frame in data.chunks_mut(target_channels) {
        let (next_l, next_r) = if channels > 1 {
            match (consumer.try_pop(), consumer.try_pop()) {
                (Some(l), Some(r)) => (l, r),
                (Some(l), None) => (l, l),
                (None, _) => (0, 0),
            }
        } else {
            let sample = consumer.try_pop().unwrap_or(0);
            (sample, sample)
        };

        let f32_l = (next_l as f32) / 32768.0;
        let f32_r = (next_r as f32) / 32768.0;

        if frame.len() >= 2 {
            frame[0] = f32_l;
            frame[1] = f32_r;
            for ch in frame.iter_mut().skip(2) {
                *ch = 0.0;
            }
        } else if !frame.is_empty() {
            frame[0] = (f32_l + f32_r) * 0.5;
        }
    }
}

/// Procesa las muestras int16 para la salida CPAL utilizando Jitter Pre-Buffering.
#[inline]
fn process_cpal_i16(
    data: &mut [i16],
    target_channels: usize,
    channels: u16,
    consumer: &mut HeapCons<i16>,
) {
    if !IS_PLAYING.load(Ordering::Relaxed) {
        data.fill(0);
        return;
    }

    if !PREBUFFER_READY.load(Ordering::Relaxed) {
        if consumer.occupied_len() >= PREBUFFER_MIN_SAMPLES {
            PREBUFFER_READY.store(true, Ordering::Relaxed);
        } else {
            data.fill(0);
            return;
        }
    }

    if consumer.occupied_len() == 0 {
        PREBUFFER_READY.store(false, Ordering::Relaxed);
        data.fill(0);
        return;
    }

    for frame in data.chunks_mut(target_channels) {
        let (next_l, next_r) = if channels > 1 {
            match (consumer.try_pop(), consumer.try_pop()) {
                (Some(l), Some(r)) => (l, r),
                (Some(l), None) => (l, l),
                (None, _) => (0, 0),
            }
        } else {
            let sample = consumer.try_pop().unwrap_or(0);
            (sample, sample)
        };

        if frame.len() >= 2 {
            frame[0] = next_l;
            frame[1] = next_r;
            for ch in frame.iter_mut().skip(2) {
                *ch = 0;
            }
        } else if !frame.is_empty() {
            frame[0] = ((next_l as i32 + next_r as i32) / 2) as i16;
        }
    }
}

// Callbacks FFI de Audio para Moonlight-common-c

/// # Safety
/// Callback FFI invocado por Moonlight-common-c para inicializar el subsistema de audio.
pub unsafe extern "C" fn ar_init(
    _audio_configuration: c_int,
    opus_config: *const c_void,
    _context: *mut c_void,
    _ar_flags: c_int,
) -> c_int {
    let (sample_rate, channels) = if !opus_config.is_null() {
        let cfg = &*(opus_config as *const OpusMultistreamConfig);
        let sr = if cfg.sample_rate > 0 {
            cfg.sample_rate as u32
        } else {
            DEFAULT_SAMPLE_RATE
        };
        let ch = if cfg.channel_count > 0 {
            cfg.channel_count as u16
        } else {
            DEFAULT_CHANNELS
        };
        (sr, ch)
    } else {
        (DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS)
    };

    log::info!(
        "Moonlight Audio: Init - Opus ({} Hz, {} ch)",
        sample_rate,
        channels
    );

    AUDIO_FRAME_COUNT.store(0, Ordering::Relaxed);
    IS_PLAYING.store(true, Ordering::SeqCst);
    PREBUFFER_READY.store(false, Ordering::SeqCst);

    let stereo_decoder = match OpusDecoder::new(sample_rate, Channels::Stereo) {
        Ok(dec) => dec,
        Err(e) => {
            log::error!(
                "Moonlight Audio: Error creando decodificador Opus estéreo: {:?}",
                e
            );
            return -1;
        }
    };

    let mono_decoder = match OpusDecoder::new(sample_rate, Channels::Mono) {
        Ok(dec) => dec,
        Err(e) => {
            log::error!(
                "Moonlight Audio: Error creando decodificador Opus mono: {:?}",
                e
            );
            return -1;
        }
    };

    let (stream_opt, producer_opt) = match init_cpal_player(sample_rate, 2) {
        Some((st, pr)) => (Some(st), Some(pr)),
        None => (None, None),
    };

    if let Ok(mut player_guard) = NATIVE_PLAYER.lock() {
        *player_guard = stream_opt.map(|stream| NativeAudioPlayer { _stream: stream });
    }

    let state = AudioStreamState {
        stereo_decoder,
        mono_decoder,
        producer: producer_opt,
        sample_rate,
        channels: 2,
    };

    if let Ok(mut state_guard) = AUDIO_STATE.lock() {
        *state_guard = Some(state);
    }

    log::info!("Moonlight Audio: Decodificadores Opus y subsistema CPAL listos");
    0
}

/// # Safety
/// Callback FFI invocado por Moonlight-common-c al iniciar la reproducción de audio.
pub unsafe extern "C" fn ar_start() {
    log::info!("Moonlight Audio: Start");
    IS_PLAYING.store(true, Ordering::SeqCst);
    if let Ok(guard) = NATIVE_PLAYER.lock() {
        if let Some(player) = guard.as_ref() {
            let _ = player._stream.play();
        }
    }
}

/// # Safety
/// Callback FFI invocado por Moonlight-common-c al pausar la reproducción de audio.
pub unsafe extern "C" fn ar_stop() {
    log::info!("Moonlight Audio: Stop");
    IS_PLAYING.store(false, Ordering::SeqCst);
    if let Ok(guard) = NATIVE_PLAYER.lock() {
        if let Some(player) = guard.as_ref() {
            let _ = player._stream.pause();
        }
    }
}

/// # Safety
/// Callback FFI invocado por Moonlight-common-c al destruir la conexión de audio.
pub unsafe extern "C" fn ar_cleanup() {
    log::info!("Moonlight Audio: Cleanup");
    IS_PLAYING.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = NATIVE_PLAYER.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = AUDIO_STATE.lock() {
        *guard = None;
    }
}

/// Elimina el relleno PKCS7 añadido por el cifrado AES-CBC en la capa de red Moonlight.
#[inline]
fn strip_pkcs7_padding(data: &[u8]) -> &[u8] {
    let Some(&last_byte) = data.last() else {
        return data;
    };
    let pad_len = last_byte as usize;
    if pad_len > 0 && pad_len <= 16 && pad_len <= data.len() {
        if data[data.len() - pad_len..]
            .iter()
            .all(|&b| b as usize == pad_len)
        {
            return &data[..data.len() - pad_len];
        }
    }
    data
}

/// Decodifica una trama Opus (Mono o Estéreo) utilizando la librería `libopus`.
fn decode_opus_frame(
    state: &mut AudioStreamState,
    clean_bytes: &[u8],
    pcm_buf: &mut [i16; MAX_FRAME_SAMPLES],
) -> Option<usize> {
    let is_mono_flag = !clean_bytes.is_empty() && (clean_bytes[0] & 0x04) == 0;

    if is_mono_flag {
        let mut mono_buf = [0i16; MAX_FRAME_SAMPLES];
        if let Ok(samples) = state
            .mono_decoder
            .decode(clean_bytes, &mut mono_buf[..], false)
        {
            for i in 0..samples {
                let sample = mono_buf[i];
                if i * 2 + 1 < MAX_FRAME_SAMPLES {
                    pcm_buf[i * 2] = sample;
                    pcm_buf[i * 2 + 1] = sample;
                }
            }
            return Some(samples);
        }
        // Fallback a decodificador estéreo
        state
            .stereo_decoder
            .decode(clean_bytes, &mut pcm_buf[..], false)
            .ok()
    } else {
        if let Ok(samples) = state
            .stereo_decoder
            .decode(clean_bytes, &mut pcm_buf[..], false)
        {
            return Some(samples);
        }
        // Fallback a decodificador mono con duplicación de canal
        let mut mono_buf = [0i16; MAX_FRAME_SAMPLES];
        let samples = state
            .mono_decoder
            .decode(clean_bytes, &mut mono_buf[..], false)
            .ok()?;
        for i in 0..samples {
            let sample = mono_buf[i];
            if i * 2 + 1 < MAX_FRAME_SAMPLES {
                pcm_buf[i * 2] = sample;
                pcm_buf[i * 2 + 1] = sample;
            }
        }
        Some(samples)
    }
}

/// # Safety
/// Callback FFI invocado por Moonlight-common-c para decodificar y reproducir cada paquete de audio.
pub unsafe extern "C" fn ar_decode_and_play_sample(sample_data: *mut c_char, sample_length: c_int) {
    let count = AUDIO_FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
    let mut stack_pcm_buf = [0i16; MAX_FRAME_SAMPLES];

    let Ok(mut state_guard) = AUDIO_STATE.lock() else {
        return;
    };
    let Some(state) = state_guard.as_mut() else {
        return;
    };

    let decoded_samples = if sample_data.is_null() || sample_length <= 0 {
        state
            .stereo_decoder
            .decode(&[], &mut stack_pcm_buf[..], false)
            .ok()
    } else {
        let raw_bytes =
            std::slice::from_raw_parts(sample_data as *const u8, sample_length as usize);
        let clean_bytes = strip_pkcs7_padding(raw_bytes);

        if count < 5 {
            let hex_preview: Vec<String> = clean_bytes
                .iter()
                .take(16)
                .map(|b| format!("{:02X}", b))
                .collect();
            log::info!(
                "[Audio] Trama Opus #{}: raw_len={}, clean_len={}, preview={}",
                count,
                sample_length,
                clean_bytes.len(),
                hex_preview.join(" ")
            );
        }

        decode_opus_frame(state, clean_bytes, &mut stack_pcm_buf)
    };

    let Some(decoded_samples_per_channel) = decoded_samples else {
        if count < 10 {
            log::warn!("[Audio] Error decodificando trama Opus #{}", count);
        }
        return;
    };

    let total_samples = decoded_samples_per_channel * (state.channels as usize);
    if total_samples == 0 || total_samples > MAX_FRAME_SAMPLES {
        return;
    }

    let pcm_slice = &stack_pcm_buf[..total_samples];

    if let Some(producer) = state.producer.as_mut() {
        let _ = producer.push_slice(pcm_slice);
    }

    if count < 5 {
        log::info!(
            "[Audio] Trama #{}: {} bytes Opus -> {} muestras PCM estéreo enviadas a CPAL",
            count,
            sample_length,
            decoded_samples_per_channel
        );
    } else if count % 1000 == 0 {
        log::info!(
            "[Audio] Trama #{}: Transmisión continua activa en hardware nativo ({} Hz, {} ch)",
            count,
            state.sample_rate,
            state.channels
        );
    }
}
