use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Producer;

use super::VoiceError;

pub fn build_input_stream<P>(producer: P) -> Result<cpal::Stream, VoiceError>
where
    P: Producer<Item = i16> + Send + 'static,
{
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or(VoiceError::NoInputDevice)?;
    let config = device.default_input_config().map_err(|e| {
        VoiceError::Cpal(format!(
            "No se pudo obtener el formato de entrada por defecto: {e}"
        ))
    })?;
    let stream_config = config.config();
    let channels = stream_config.channels as usize;
    let input_sample_rate = stream_config.sample_rate.0 as u64;
    let target_sample_rate = 16_000_u64;

    log::info!(
        "[Voice] input config: format={:?} sample_rate={} channels={}",
        config.sample_format(),
        input_sample_rate,
        channels
    );

    let mut producer = producer;
    let err_fn = |err: cpal::StreamError| {
        log::warn!("[Voice] stream error: {}", err);
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::I16 => {
            let mut resample_phase = 0_u64;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        for frame in data.chunks(channels) {
                            let sample = frame[0];
                            resample_phase += target_sample_rate;
                            while resample_phase >= input_sample_rate {
                                let _ = producer.try_push(sample);
                                resample_phase -= input_sample_rate;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| VoiceError::Cpal(e.to_string()))?
        }
        cpal::SampleFormat::F32 => {
            let mut resample_phase = 0_u64;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        for frame in data.chunks(channels) {
                            let sample = frame[0];
                            let s = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            resample_phase += target_sample_rate;
                            while resample_phase >= input_sample_rate {
                                let _ = producer.try_push(s);
                                resample_phase -= input_sample_rate;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| VoiceError::Cpal(e.to_string()))?
        }
        cpal::SampleFormat::U16 => {
            let mut resample_phase = 0_u64;
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        for frame in data.chunks(channels) {
                            let sample = frame[0];
                            let centered = sample as i32 - 32768;
                            let s = centered as i16;
                            resample_phase += target_sample_rate;
                            while resample_phase >= input_sample_rate {
                                let _ = producer.try_push(s);
                                resample_phase -= input_sample_rate;
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| VoiceError::Cpal(e.to_string()))?
        }
        other => {
            return Err(VoiceError::Cpal(format!(
                "Formato de sample no soportado para input: {:?}",
                other
            )));
        }
    };

    stream.play().map_err(|e| VoiceError::Cpal(e.to_string()))?;
    Ok(stream)
}
