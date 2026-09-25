import { invoke } from "@tauri-apps/api/core";

export type StartupWindowMode = "normal" | "big_picture";

/** Preferencia de arranque: ventana normal o Big Picture (pantalla completa en la ventana principal). */
export async function setStartupWindowMode(mode: StartupWindowMode): Promise<void> {
  await invoke("set_startup_window_mode", { mode });
}

export async function setLanguage(language: string | null): Promise<void> {
  await invoke("set_language", { language: language || null });
}

export async function getDefaultSourceDownloadDir(): Promise<string | null> {
  return invoke<string | null>("get_default_source_download_dir");
}

export async function setDefaultSourceDownloadDir(path: string | null): Promise<void> {
  await invoke("set_default_source_download_dir", { path: path?.trim() || null });
}

/** Modo desarrollador del perfil activo (persistido en el `settings.json` de ese perfil). */
export async function setDeveloperMode(enabled: boolean): Promise<void> {
  await invoke("set_developer_mode", { enabled });
}

/** Modo bajo rendimiento para reducir animaciones y uso de CPU/GPU en PCs lentas. */
export async function setLowPerformanceMode(enabled: boolean): Promise<void> {
  await invoke("set_low_performance_mode", { enabled });
}

/** Desactivar la aceleración por hardware (GPU) del webview. */
export async function setDisableHardwareAcceleration(enabled: boolean): Promise<void> {
  await invoke("set_disable_hardware_acceleration", { enabled });
}

/** Guarda la URL del proxy HTTP/HTTPS/SOCKS5 en la configuración. */
export async function setProxyUrl(proxyUrl: string | null): Promise<void> {
  await invoke("set_proxy_url", { proxyUrl });
}

/** Activa o desactiva modo juego (mitigaciones SaveCloud + ajustes de SO donde aplique). */
export async function gameModeSetEnabled(enabled: boolean): Promise<void> {
  await invoke("game_mode_set_enabled", { enabled });
}

/** Reaplica la configuración vigente cuando el modo ya está activo (tras cambiar opciones). */
export async function gameModeRefresh(): Promise<void> {
  await invoke("game_mode_refresh");
}

export async function setGameModeApplyPowerProfile(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_apply_power_profile", { enabled });
}

export async function setGameModeReduceCaptureOverhead(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_reduce_capture_overhead", { enabled });
}

export async function setGameModeThrottleSavecloudBackground(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_throttle_savecloud_background", { enabled });
}

export async function setGameModeBoostDetectedGameCpu(enabled: boolean): Promise<void> {
  await invoke("set_game_mode_boost_detected_game_cpu", { enabled });
}

export async function setAutoExtractDownloads(enabled: boolean): Promise<void> {
  await invoke("set_auto_extract_downloads", { enabled });
}

export interface OverlaySoundSettings {
  enabled: boolean;
  volume: number; // 0.0 - 1.0
}

export type OverlayPosition = "bottom-right" | "top-right" | "top-left" | "bottom-left";

export interface OverlaySettings {
  enabled: boolean;
  volume: number; // 0.0 - 1.0
  position: OverlayPosition;
}

/** Obtiene la configuración de sonido del overlay en juego. */
export async function getOverlaySoundSettings(): Promise<OverlaySoundSettings> {
  return invoke<OverlaySoundSettings>("get_overlay_sound_settings");
}

/** Guarda la configuración de sonido del overlay (activado y volumen 0.0-1.0). */
export async function setOverlaySoundSettings(settings: OverlaySoundSettings): Promise<void> {
  await invoke("set_overlay_sound_settings", {
    enabled: settings.enabled,
    volume: settings.volume,
  });
}

/** Obtiene la posición configurada para las notificaciones de overlay. */
export async function getOverlayPosition(): Promise<OverlayPosition> {
  return invoke<OverlayPosition>("get_overlay_position");
}

/** Guarda la posición de las notificaciones de overlay. */
export async function setOverlayPosition(position: OverlayPosition): Promise<void> {
  await invoke("set_overlay_position", { position });
}

/** Obtiene la configuración completa del overlay. */
export async function getOverlaySettings(): Promise<OverlaySettings> {
  return invoke<OverlaySettings>("get_overlay_settings");
}

/** Guarda la configuración completa del overlay (sonido, volumen y posición). */
export async function setOverlaySettings(settings: OverlaySettings): Promise<void> {
  await invoke("set_overlay_settings", {
    enabled: settings.enabled,
    volume: settings.volume,
    position: settings.position,
  });
}

/** Obtiene si se ignora la navegación de mando cuando SaveCloud no tiene el foco. */
export async function getGamepadIgnoreBackground(): Promise<boolean> {
  return invoke<boolean>("get_gamepad_ignore_background");
}

/** Configura si se debe ignorar el mando cuando la ventana pierde el foco. */
export async function setGamepadIgnoreBackground(ignore: boolean): Promise<void> {
  await invoke("set_gamepad_ignore_background", { ignore });
}

/** Obtiene si la subida automática a la nube al salir del juego está activa. */
export async function getAutoSyncOnGameExit(): Promise<boolean> {
  return invoke<boolean>("get_auto_sync_on_game_exit");
}

/** Activa o desactiva la subida automática al salir del juego. */
export async function setAutoSyncOnGameExit(enabled: boolean): Promise<void> {
  await invoke("set_auto_sync_on_game_exit", { enabled });
}
