#!/usr/bin/env python
"""
build_wakeword.py  —  Generador de modelo wake-word "Oye Cloud"
================================================================
Uso rápido:
    python build_wakeword.py

Con rutas personalizadas (cuando el disco principal no tiene espacio):
    python build_wakeword.py \
        --output-dir /mnt/disco_grande/oye_cloud \
        --samples-dir /tmp/wakeword_tmp

Opciones:
    --output-dir    Carpeta donde se guardará el .rpw final y subcarpetas de recursos.
                    Por defecto: <raíz_proyecto>/src-tauri/resources
    --samples-dir   Carpeta temporal para WAVs/MP3s durante la construcción.
                    Si no se indica se crea dentro de --output-dir.
    --keep-samples  No borra las muestras WAV tras construir el modelo.
    --max-samples   Límite de samples sintéticos (por defecto 48).
    --user-samples  Carpeta con WAVs reales del usuario.
                    Por defecto: <output-dir>/wakeword_user_samples
"""
from __future__ import annotations

import argparse
import asyncio
import os
import pathlib
import subprocess
import sys
import tempfile
from typing import Iterable, List

import edge_tts
import imageio_ffmpeg


# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
WAKE_PHRASE = "Oye Cloud"
WAKE_NAME = "oye_cloud"

# Tasas y tono: más variantes = modelo más robusto a diferentes locutores
EDGE_RATE_VARIANTS = ["-20%", "-10%", "+0%", "+10%", "+20%"]
EDGE_PITCH_VARIANTS = ["-6Hz", "-3Hz", "+0Hz", "+3Hz", "+6Hz"]

# Voces: variedades del español + inglés multilingüe como fallback acústico
VOICE_IDS = [
    # España
    "es-ES-AlvaroNeural",
    "es-ES-ElviraNeural",
    # México
    "es-MX-DaliaNeural",
    "es-MX-JorgeNeural",
    # Colombia  ← prioritarios para el caso de uso
    "es-CO-GonzaloNeural",
    "es-CO-SalomeNeural",
    # Argentina
    "es-AR-ElenaNeural",
    "es-AR-TomasNeural",
    # Chile
    "es-CL-CatalinaNeural",
    "es-CL-LorenzoNeural",
    # Perú
    "es-PE-CamilaNeural",
    "es-PE-AlexNeural",
    # Venezuela
    "es-VE-PaolaNeural",
    "es-VE-SebastianNeural",
    # Ecuador
    "es-EC-AndreaNeural",
    "es-EC-LuisNeural",
    # Inglés multilingüe (útil como variante acústica para frases cortas)
    "en-US-AvaMultilingualNeural",
    "en-US-AndrewMultilingualNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
]

# Niveles de ruido blanco para augmentación
NOISE_LEVELS_DB = ["-36dB", "-30dB", "-24dB", "-18dB"]

# Reverb (sala pequeña) para simular micrófonos lejanos
REVERB_PARAMS = [
    # (reverberance, hf_damping, room_scale, stereo_depth, pre_delay, wet_gain)
    (20, 50, 10, 0, 0, -6),
    (40, 50, 30, 0, 5, -9),
]

# Variantes de velocidad de reproducción (sin cambiar tono) para augmentación adicional
SPEED_VARIANTS = [0.90, 1.00, 1.10]


# ---------------------------------------------------------------------------
# Helpers de audio
# ---------------------------------------------------------------------------

def normalize_wav(
    ffmpeg_exe: str,
    source: pathlib.Path,
    output: pathlib.Path,
    loudness_norm: bool = True,
) -> None:
    """Convierte a WAV mono 16 kHz PCM 16-bit con normalización de loudness opcional."""
    filters = "loudnorm" if loudness_norm else ""
    cmd = [
        ffmpeg_exe, "-y", "-i", str(source),
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
    ]
    if filters:
        cmd += ["-af", filters]
    cmd.append(str(output))
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def augment_wav(
    ffmpeg_exe: str,
    clean_wav: pathlib.Path,
    output_dir: pathlib.Path,
    add_noise: bool = True,
    add_reverb: bool = True,
    add_speed: bool = True,
    reverb_only_first_n: bool = False,
) -> List[pathlib.Path]:
    """
    Genera TODAS las variantes de un WAV limpio y las devuelve.
    Llama a esta función de una en una para poder borrar el clean_wav
    inmediatamente después si se desea.
    """
    generated: List[pathlib.Path] = []
    base = clean_wav.stem

    if add_noise:
        for idx, noise_db in enumerate(NOISE_LEVELS_DB, start=1):
            out = output_dir / f"{base}_noise_{idx:02d}.wav"
            subprocess.run(
                [
                    ffmpeg_exe, "-y", "-i", str(clean_wav),
                    "-filter_complex",
                    (
                        f"anoisesrc=color=white:amplitude=0.15,volume={noise_db}[n];"
                        "[0:a][n]amix=inputs=2:weights=1 1:normalize=0:duration=first"
                    ),
                    "-shortest",
                    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out),
                ],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            generated.append(out)

    if add_reverb:
        aecho_presets = [
            ("0.8", "0.7", "20", "0.5"),
            ("0.8", "0.6", "40", "0.4"),
            ("0.7", "0.5", "60", "0.3"),
        ]
        for idx, (ig, og, delay, decay) in enumerate(aecho_presets, start=1):
            out = output_dir / f"{base}_reverb_{idx:02d}.wav"
            subprocess.run(
                [ffmpeg_exe, "-y", "-i", str(clean_wav),
                 "-af", f"aecho={ig}:{og}:{delay}:{decay}",
                 "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            generated.append(out)

    if add_speed:
        for idx, speed in enumerate(SPEED_VARIANTS, start=1):
            if speed == 1.0:
                continue
            out = output_dir / f"{base}_speed_{idx:02d}.wav"
            subprocess.run(
                [ffmpeg_exe, "-y", "-i", str(clean_wav),
                 "-af", f"atempo={speed}",
                 "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            generated.append(out)

    return generated


# ---------------------------------------------------------------------------
# Síntesis TTS
# ---------------------------------------------------------------------------

def iterate_synth_variants() -> Iterable[tuple[str, str, str]]:
    for voice in VOICE_IDS:
        for rate in EDGE_RATE_VARIANTS:
            for pitch in EDGE_PITCH_VARIANTS:
                yield (voice, rate, pitch)


async def create_samples_async(
    samples_dir: pathlib.Path,
    max_samples: int,
) -> List[pathlib.Path]:
    generated: List[pathlib.Path] = []
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    total_variants = len(VOICE_IDS) * len(EDGE_RATE_VARIANTS) * len(EDGE_PITCH_VARIANTS)
    limit = min(max_samples, total_variants)

    print(f"[TTS] Sintetizando hasta {limit} muestras con {len(VOICE_IDS)} voces…")
    for index, (voice_id, rate, pitch) in enumerate(iterate_synth_variants(), start=1):
        if len(generated) >= limit:
            break
        mp3_out = samples_dir / f"oye_cloud_{index:03d}.mp3"
        wav_out = samples_dir / f"oye_cloud_{index:03d}.wav"
        try:
            communicator = edge_tts.Communicate(
                text=WAKE_PHRASE,
                voice=voice_id,
                rate=rate,
                pitch=pitch,
            )
            await communicator.save(str(mp3_out))
            normalize_wav(ffmpeg_exe, mp3_out, wav_out)
            generated.append(wav_out)
            # Elimina el MP3 inmediatamente para ahorrar espacio
            mp3_out.unlink(missing_ok=True)
            print(
                f"  [{len(generated):3d}/{limit}] {voice_id:35s} rate={rate:4s} pitch={pitch:5s}",
                end="\r",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"\n  ⚠ Error con {voice_id} rate={rate} pitch={pitch}: {exc}")
    print(f"\n[TTS] {len(generated)} muestras sintetizadas.")
    return generated


def create_samples(samples_dir: pathlib.Path, max_samples: int) -> List[pathlib.Path]:
    return asyncio.run(create_samples_async(samples_dir, max_samples))


# ---------------------------------------------------------------------------
# Construcción del modelo
# ---------------------------------------------------------------------------

def build_model(samples: List[pathlib.Path], model_path: pathlib.Path) -> None:
    cmd = [
        "rustpotter-cli", "build",
        "--name", WAKE_NAME,
        "--path", str(model_path),
    ]
    cmd.extend(str(p) for p in samples)
    print(f"[BUILD] Entrenando modelo con {len(samples)} muestras…")
    subprocess.run(cmd, check=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generador de wake-word 'Oye Cloud' para Rustpotter.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=None,
        help=(
            "Directorio de salida para el modelo .rpw y subcarpetas de recursos. "
            "Por defecto: <raíz_proyecto>/src-tauri/resources"
        ),
    )
    parser.add_argument(
        "--samples-dir",
        type=pathlib.Path,
        default=None,
        help=(
            "Directorio temporal para WAVs durante la construcción. "
            "Útil cuando el disco principal no tiene espacio. "
            "Por defecto: <output-dir>/wakeword_samples"
        ),
    )
    parser.add_argument(
        "--user-samples",
        type=pathlib.Path,
        default=None,
        help=(
            "Carpeta con WAVs reales grabados por el usuario. "
            "Por defecto: <output-dir>/wakeword_user_samples"
        ),
    )
    parser.add_argument(
        "--model-path",
        type=pathlib.Path,
        default=None,
        help="Ruta completa del archivo .rpw a generar. Por defecto: <output-dir>/oye_cloud.rpw",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=48,
        help="Límite de muestras sintéticas base (sin contar augmentación). Por defecto: 48",
    )
    parser.add_argument(
        "--keep-samples",
        action="store_true",
        default=False,
        help="No borrar las muestras WAV/MP3 después de construir el modelo.",
    )
    parser.add_argument(
        "--no-noise",
        action="store_true",
        default=False,
        help="Omitir augmentación con ruido blanco.",
    )
    parser.add_argument(
        "--no-reverb",
        action="store_true",
        default=False,
        help="Omitir augmentación con reverberación.",
    )
    parser.add_argument(
        "--no-speed",
        action="store_true",
        default=False,
        help="Omitir augmentación con variantes de velocidad.",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    # --- Resolver rutas ---
    if args.output_dir is not None:
        resources = args.output_dir.resolve()
    else:
        root = pathlib.Path(__file__).resolve().parents[1]
        resources = root / "src-tauri" / "resources"

    if args.samples_dir is not None:
        samples_dir = args.samples_dir.resolve()
        _tmp_dir_obj = None  # gestionado por el usuario
    else:
        # Si no se especifica, se crea dentro de output-dir pero con aviso de espacio
        samples_dir = resources / "wakeword_samples"
        _tmp_dir_obj = None

    user_samples_dir = (
        args.user_samples.resolve()
        if args.user_samples
        else resources / "wakeword_user_samples"
    )
    model_path = (
        args.model_path.resolve()
        if args.model_path
        else resources / "oye_cloud.rpw"
    )

    # --- Crear directorios ---
    resources.mkdir(parents=True, exist_ok=True)
    samples_dir.mkdir(parents=True, exist_ok=True)
    user_samples_dir.mkdir(parents=True, exist_ok=True)
    model_path.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  Generador de wake-word  •  Oye Cloud")
    print("=" * 60)
    print(f"  Output dir   : {resources}")
    print(f"  Samples dir  : {samples_dir}")
    print(f"  User samples : {user_samples_dir}")
    print(f"  Modelo .rpw  : {model_path}")
    print(f"  Max samples  : {args.max_samples}")
    print("=" * 60)

    # --- Limpiar muestras antiguas ---
    for old in [*samples_dir.glob("*.wav"), *samples_dir.glob("*.mp3")]:
        old.unlink(missing_ok=True)

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    # 1. Síntesis TTS
    synth_samples = create_samples(samples_dir=samples_dir, max_samples=args.max_samples)
    if len(synth_samples) < 8:
        raise RuntimeError(
            f"Solo se generaron {len(synth_samples)} muestras (mínimo 8 requeridas). "
            "Verifica la conexión a internet para edge-tts."
        )

    # Contadores para el resumen final
    count_synth = len(synth_samples)
    count_noise = count_reverb = count_speed = count_user = 0

    # rustpotter-cli acepta múltiples archivos en el comando build.
    # Construimos la lista completa de paths a pasar, pero procesando
    # augmentaciones de a una para no acumularlas todas en disco.
    all_sample_paths: List[pathlib.Path] = []

    # Cuántos samples base reciben reverb/speed (subconjunto para no inflar)
    reverb_speed_limit = min(count_synth, 20)

    print("[AUG] Generando augmentaciones (procesa y borra al vuelo)…")
    for i, clean in enumerate(synth_samples):
        apply_reverb = (not args.no_reverb) and (i < reverb_speed_limit)
        apply_speed  = (not args.no_speed)  and (i < reverb_speed_limit)

        variants = augment_wav(
            ffmpeg_exe=ffmpeg_exe,
            clean_wav=clean,
            output_dir=samples_dir,
            add_noise=not args.no_noise,
            add_reverb=apply_reverb,
            add_speed=apply_speed,
        )

        # Contadores
        count_noise  += sum(1 for p in variants if "_noise_"  in p.name)
        count_reverb += sum(1 for p in variants if "_reverb_" in p.name)
        count_speed  += sum(1 for p in variants if "_speed_"  in p.name)

        # Acumular paths para el build final
        all_sample_paths.append(clean)
        all_sample_paths.extend(variants)

        print(
            f"  sample {i+1:3d}/{count_synth}  "
            f"(+{len(variants)} variantes)",
            end="\r", flush=True,
        )

    print(f"\n[AUG] Augmentación completa.")

    # 2. Muestras reales del usuario
    user_sample_paths: List[pathlib.Path] = []
    raw_user_wavs = sorted(user_samples_dir.glob("*.wav"))
    if raw_user_wavs:
        print(f"[USER] Normalizando {len(raw_user_wavs)} muestras reales…")
        for idx, wav in enumerate(raw_user_wavs, start=1):
            normalized = samples_dir / f"user_{idx:03d}.wav"
            normalize_wav(ffmpeg_exe, wav, normalized, loudness_norm=True)
            user_sample_paths.append(normalized)
            if not args.no_noise:
                variants = augment_wav(
                    ffmpeg_exe=ffmpeg_exe,
                    clean_wav=normalized,
                    output_dir=samples_dir,
                    add_noise=True,
                    add_reverb=False,
                    add_speed=False,
                )
                user_sample_paths.extend(variants)
                count_noise += len(variants)
        count_user = len(raw_user_wavs)
        print(f"[USER] {len(user_sample_paths)} archivos de muestras reales listos.")
    else:
        print(f"[USER] No se encontraron muestras reales. Añade WAVs a: {user_samples_dir}")

    # 3. Construir modelo (todos los paths en memoria, archivos aún en disco)
    all_samples = [*all_sample_paths, *user_sample_paths]
    total = count_synth + count_noise + count_reverb + count_speed + count_user
    print(
        f"\n[TOTAL] {len(all_samples)} archivos de entrenamiento: "
        f"sintéticas={count_synth} ruido={count_noise} "
        f"reverb={count_reverb} velocidad={count_speed} reales={count_user}"
    )
    build_model(samples=all_samples, model_path=model_path)

    # 4. Limpieza — ahora sí borramos todo de golpe (el modelo ya está construido)
    if not args.keep_samples:
        cleaned = 0
        for ext in ("*.wav", "*.mp3"):
            for f in samples_dir.glob(ext):
                f.unlink(missing_ok=True)
                cleaned += 1
        try:
            samples_dir.rmdir()
        except OSError:
            pass
        print(f"[CLEAN] {cleaned} archivos temporales eliminados.")
    else:
        print(f"[CLEAN] Muestras conservadas en: {samples_dir}")

    # 8. Resumen final
    size_kb = os.path.getsize(model_path) // 1024
    print("\n" + "=" * 60)
    print(f"  ✓ Modelo: {model_path}")
    print(f"  ✓ Tamaño: {size_kb} KB")
    print("=" * 60)
    print(
        "\nTip: añade tus propios WAVs (16 kHz, mono, PCM) a:\n"
        f"  {user_samples_dir}\n"
        "y vuelve a ejecutar el script para mejorar el reconocimiento de tu voz."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrumpido por el usuario.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001
        print(f"\nError generando wake word: {exc}", file=sys.stderr)
        raise SystemExit(1)