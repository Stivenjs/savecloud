//! Estado de caché y telemetría para la pantalla "Probar mando" en Ajustes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use gilrs::{
    ff::{BaseEffect, BaseEffectType, EffectBuilder, Repeat, Replay, Ticks},
    Axis, Button, GamepadId, Gilrs,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct GamepadSummary {
    pub id: usize,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GamepadListChangedPayload {
    pub gamepads: Vec<GamepadSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GamepadTelemetry {
    pub id: usize,
    pub name: String,
    pub axes: HashMap<String, f32>,
    pub pressed_buttons: Vec<String>,
    pub button_values: HashMap<String, f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GamepadStatePayload {
    pub gamepads: Vec<GamepadTelemetry>,
}

static GAMEPAD_CACHE: Mutex<Vec<GamepadSummary>> = Mutex::new(Vec::new());
static TESTER_SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);
static GAMEPAD_FF_TX: OnceLock<SyncSender<GamepadFfCmd>> = OnceLock::new();

#[derive(Debug)]
pub(crate) enum GamepadFfCmd {
    TestRumble { gamepad_index: usize },
}

pub(crate) fn init_gamepad_ff_channel() -> Receiver<GamepadFfCmd> {
    let (tx, rx) = mpsc::sync_channel::<GamepadFfCmd>(8);
    let _ = GAMEPAD_FF_TX.set(tx);
    rx
}

pub fn enqueue_test_rumble(gamepad_index: usize) -> Result<(), String> {
    let tx = GAMEPAD_FF_TX
        .get()
        .ok_or_else(|| "El proceso de entrada de mandos no está listo.".to_string())?;
    tx.try_send(GamepadFfCmd::TestRumble { gamepad_index })
        .map_err(|e| match e {
            mpsc::TrySendError::Full(_) => {
                "Demasiadas peticiones seguidas; espera un instante.".to_string()
            }
            mpsc::TrySendError::Disconnected(_) => "La cola del mando se cerró.".to_string(),
        })
}

pub(crate) fn drain_ff_queue(gilrs: &mut Gilrs, rx: &Receiver<GamepadFfCmd>) {
    while let Ok(cmd) = rx.try_recv() {
        match cmd {
            GamepadFfCmd::TestRumble { gamepad_index } => {
                if let Err(e) = run_test_rumble(gilrs, gamepad_index) {
                    log::debug!("[gamepad ff] {:?}", e);
                }
            }
        }
    }
}

fn run_test_rumble(gilrs: &mut Gilrs, gilrs_index: usize) -> Result<(), String> {
    let gid = gilrs
        .gamepads()
        .filter(|(_, gp)| gp.is_connected())
        .find(|(id, _)| usize::from(*id) == gilrs_index)
        .map(|(id, _)| id)
        .ok_or_else(|| format!("gamepad {} desconectado", gilrs_index))?;
    let gp = gilrs
        .connected_gamepad(gid)
        .ok_or_else(|| format!("gamepad {} desconectado", gilrs_index))?;
    if !gp.is_ff_supported() {
        return Err(format!(
            "El mando «{}» no admite fuerza háptica en esta sesión/platforma.",
            gp.name()
        ));
    }

    let play_ticks = Ticks::from_ms(320);
    let mut builder = EffectBuilder::new();
    builder.repeat(Repeat::For(play_ticks + Ticks::from_ms(64)));
    builder.add_effect(BaseEffect {
        kind: BaseEffectType::Strong { magnitude: 65_000 },
        scheduling: Replay {
            play_for: play_ticks,
            ..Default::default()
        },
        envelope: Default::default(),
    });
    builder.add_effect(BaseEffect {
        kind: BaseEffectType::Weak { magnitude: 55_000 },
        scheduling: Replay {
            play_for: play_ticks,
            ..Default::default()
        },
        envelope: Default::default(),
    });
    builder.gamepads(&[gid]);

    let effect = builder
        .finish(gilrs)
        .map_err(|e| format!("No se creó efecto háptico: {e}"))?;
    effect
        .play()
        .map_err(|e| format!("No se pudo iniciar vibración: {e}"))?;

    let keeper = effect.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        drop(keeper);
    });
    Ok(())
}

static BUTTONS_ALL: &[Button] = &[
    Button::South,
    Button::East,
    Button::North,
    Button::West,
    Button::C,
    Button::Z,
    Button::LeftTrigger,
    Button::LeftTrigger2,
    Button::RightTrigger,
    Button::RightTrigger2,
    Button::Select,
    Button::Start,
    Button::Mode,
    Button::LeftThumb,
    Button::RightThumb,
    Button::DPadUp,
    Button::DPadDown,
    Button::DPadLeft,
    Button::DPadRight,
];

static AXES_ALL: &[Axis] = &[
    Axis::LeftStickX,
    Axis::LeftStickY,
    Axis::LeftZ,
    Axis::RightStickX,
    Axis::RightStickY,
    Axis::RightZ,
    Axis::DPadX,
    Axis::DPadY,
];

/// Alguna ventana SaveCloud debe recibir entrada (mando / HUD).
///
/// En Windows + WebView2, `WebviewWindow::is_focused()` a veces sigue en `false` justo tras
/// `show` + fullscreen aunque **el foreground de Windows** ya es esa ventana — el mando queda
/// “mudo” hasta un alt-tab que fuerza otro ciclo de activación. Comparamos el **HWND raíz**
/// (`GetAncestor(..., GA_ROOT)`) con `GetForegroundWindow()` para alinear con lo que el SO
/// considera ventana activa.
pub fn relevant_app_focus(app: &AppHandle) -> bool {
    [
        "main",
        "settings-window",
        "big-picture-window",
        "friends-window",
    ]
    .into_iter()
    .any(|label| {
        let Some(w) = app.get_webview_window(label) else {
            return false;
        };
        if w.is_focused().unwrap_or(false) {
            return true;
        }
        #[cfg(windows)]
        {
            webview_root_matches_foreground(&w).unwrap_or(false)
        }
        #[cfg(not(windows))]
        {
            let _ = w;
            false
        }
    })
}

#[cfg(windows)]
fn webview_root_matches_foreground(w: &tauri::WebviewWindow) -> Option<bool> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};

    let handle = w.window_handle().ok()?;
    let RawWindowHandle::Win32(h) = handle.as_raw() else {
        return Some(false);
    };

    unsafe {
        let self_hwnd = HWND(h.hwnd.get() as usize as *mut c_void);
        let fg = GetForegroundWindow();
        if self_hwnd.0.is_null() || fg.0.is_null() {
            return Some(false);
        }
        let self_root = GetAncestor(self_hwnd, GA_ROOT);
        let fg_root = GetAncestor(fg, GA_ROOT);
        if self_root.is_invalid() || fg_root.is_invalid() {
            return Some(false);
        }
        Some(self_root == fg_root)
    }
}

pub fn gamepad_tester_session_start() {
    TESTER_SESSION_ACTIVE.store(true, Ordering::Release);
}

pub fn gamepad_tester_session_stop() {
    TESTER_SESSION_ACTIVE.store(false, Ordering::Release);
}

pub fn tester_session_active() -> bool {
    TESTER_SESSION_ACTIVE.load(Ordering::Acquire)
}

pub fn list_cached_gamepads() -> Vec<GamepadSummary> {
    GAMEPAD_CACHE.lock().map(|g| g.clone()).unwrap_or_default()
}

pub fn sync_gamepad_list_cache_emit(app: &AppHandle, gilrs: &Gilrs) {
    let list = build_gamepad_summaries(gilrs);
    if let Ok(mut g) = GAMEPAD_CACHE.lock() {
        *g = list.clone();
    }
    let payload = GamepadListChangedPayload { gamepads: list };
    let _ = app.emit("gamepad_list_changed", &payload);
}

pub fn refresh_gamepad_cache(gilrs: &Gilrs) {
    let list = build_gamepad_summaries(gilrs);
    if let Ok(mut g) = GAMEPAD_CACHE.lock() {
        *g = list;
    }
}

fn build_gamepad_summaries(gilrs: &Gilrs) -> Vec<GamepadSummary> {
    gilrs
        .gamepads()
        .filter(|(_, gp)| gp.is_connected())
        .map(|(gid, gp)| GamepadSummary {
            id: usize::from(gid),
            name: gp.name().to_string(),
        })
        .collect()
}

pub fn emit_gamepad_state_if_due(
    app: &AppHandle,
    gilrs: &Gilrs,
    focused: bool,
    last_emit: &mut std::time::Instant,
) -> bool {
    if !tester_session_active() || !focused {
        return false;
    }

    let now = std::time::Instant::now();
    const MIN_INTERVAL: std::time::Duration = std::time::Duration::from_micros(33_333);
    if now.duration_since(*last_emit) < MIN_INTERVAL {
        return false;
    }

    let gamepads: Vec<GamepadTelemetry> = gilrs
        .gamepads()
        .filter(|(_, gp)| gp.is_connected())
        .map(|(gid, gp)| telemetry_for_gamepad(gid, &gp))
        .collect();

    let payload = GamepadStatePayload { gamepads };
    let _ = app.emit("gamepad_state", &payload);
    *last_emit = now;
    true
}

fn telemetry_for_gamepad(id: GamepadId, gp: &gilrs::Gamepad<'_>) -> GamepadTelemetry {
    let mut axes_map = HashMap::new();
    for &axis in AXES_ALL {
        if let Some(ad) = gp.axis_data(axis) {
            axes_map.insert(format!("{axis:?}"), ad.value());
        }
    }

    let mut pressed_buttons = Vec::new();
    let mut button_values = HashMap::new();
    for &btn in BUTTONS_ALL {
        #[cfg(windows)]
        {
            if matches!(btn, Button::Mode)
                && usize::from(id) < 4
                && super::xinput_guide::is_guide_pressed(usize::from(id))
            {
                pressed_buttons.push("Mode".to_string());
                continue;
            }
        }
        if let Some(bd) = gp.button_data(btn) {
            if bd.is_pressed() {
                pressed_buttons.push(format!("{btn:?}"));
            }
            let v = bd.value();
            if v > f32::EPSILON {
                button_values.insert(format!("{btn:?}"), v);
            }
        }
    }

    GamepadTelemetry {
        id: usize::from(id),
        name: gp.name().to_string(),
        axes: axes_map,
        pressed_buttons,
        button_values,
    }
}
