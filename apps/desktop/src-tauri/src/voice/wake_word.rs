use std::path::PathBuf;
use std::time::{Duration, Instant};

use ringbuf::traits::Consumer;
use rustpotter::{
    AudioFmt, BandPassConfig, DetectorConfig, Endianness, FiltersConfig, GainNormalizationConfig,
    Rustpotter, RustpotterConfig, SampleFormat, ScoreMode,
};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::{VoiceError, WAKE_WORD_EVENT};

fn build_rustpotter() -> Result<Rustpotter, VoiceError> {
    let config = RustpotterConfig {
        detector: DetectorConfig {
            threshold: 0.30,
            avg_threshold: 0.18,
            min_scores: 2,
            score_mode: ScoreMode::Average,
            ..DetectorConfig::default()
        },
        filters: FiltersConfig {
            gain_normalizer: GainNormalizationConfig {
                enabled: true,
                gain_ref: None,
                min_gain: 0.7,
                max_gain: 1.3,
            },
            band_pass: BandPassConfig {
                enabled: true,
                low_cutoff: 85.0,
                high_cutoff: 3_400.0,
            },
        },
        fmt: AudioFmt {
            sample_rate: 16_000,
            sample_format: SampleFormat::I16,
            channels: 1,
            endianness: Endianness::Little,
        },
    };
    Rustpotter::new(&config).map_err(VoiceError::Rustpotter)
}

pub fn run_detection_loop<C>(
    app: AppHandle,
    mut consumer: C,
    model_path: PathBuf,
    stop: CancellationToken,
) -> Result<(), VoiceError>
where
    C: Consumer<Item = i16>,
{
    let mut rustpotter = build_rustpotter()?;
    let model_path = model_path.to_string_lossy().to_string();
    rustpotter
        .add_wakeword_from_file("oye_cloud", &model_path)
        .map_err(VoiceError::Rustpotter)?;

    let frame_len = rustpotter.get_samples_per_frame();
    let mut frame = vec![0i16; frame_len];
    let mut last_emit = Instant::now()
        .checked_sub(Duration::from_secs(2))
        .unwrap_or_else(Instant::now);

    while !stop.is_cancelled() {
        let mut filled = 0usize;
        while filled < frame_len {
            if let Some(sample) = consumer.try_pop() {
                frame[filled] = sample;
                filled += 1;
            } else {
                break;
            }
        }

        if filled < frame_len {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }

        if let Some(detection) = rustpotter.process_samples(frame.clone()) {
            if detection.score >= 0.30 && last_emit.elapsed() >= Duration::from_millis(900) {
                let _ = app.emit(WAKE_WORD_EVENT, detection.name);
                last_emit = Instant::now();
            }
        }
    }

    Ok(())
}
