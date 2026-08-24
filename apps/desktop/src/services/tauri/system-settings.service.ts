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
