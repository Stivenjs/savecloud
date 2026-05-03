import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { inferGamepadLayoutKind, type GamepadLayoutKind } from "@/lib/gamepadLabelMaps";
import { toastError, toastInfo, toastSuccess } from "@/utils/toast";

export interface GamepadSummaryDto {
  id: number;
  name: string;
}

interface GamepadListChangedPayload {
  gamepads: GamepadSummaryDto[];
}

export interface GamepadTelemetryDto {
  id: number;
  name: string;
  axes: Record<string, number>;
  pressed_buttons: string[];
  button_values: Record<string, number>;
}

interface GamepadStatePayload {
  gamepads: GamepadTelemetryDto[];
}

export function formatGamepadFloat(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "0.000";
  return v.toFixed(3);
}

export function gamepadAxisValue(axes: Record<string, number>, key: string): number {
  const v = axes[key];
  return typeof v === "number" ? v : 0;
}

/**
 * Presión efectiva del gatillo (0–1): eje analógico (`LeftZ`/`RightZ`), valor del botón en gilrs
 * (`button_values`) y pulsación digital. En XInput a veces el eje llega vacío pero el botón lleva el valor.
 */
export function gamepadTriggerLevel(
  axes: Record<string, number>,
  buttonValues: Record<string, number>,
  pressed: Set<string>,
  side: "left" | "right"
): number {
  const zKey = side === "left" ? "LeftZ" : "RightZ";
  const btnKey = side === "left" ? "LeftTrigger" : "RightTrigger";
  const fromAxis = gamepadAxisValue(axes, zKey);
  const fromBtn = gamepadAxisValue(buttonValues, btnKey);
  const digital = pressed.has(btnKey) ? 1 : 0;
  const v = Math.max(fromAxis, fromBtn, digital);
  return Math.max(0, Math.min(1, v));
}

export interface UseGamepadTesterResult {
  /** `false` en navegador sin Tauri. */
  isDesktop: boolean;
  isWindowsDesktop: boolean;
  gamepads: GamepadSummaryDto[];
  selectedId: number | null;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  selectedKey: string;
  selectedTelemetry: GamepadTelemetryDto | null;
  /** Nombre del dispositivo seleccionado (para leyendas). */
  selectedGamepadName: string | null;
  /** Perfil de etiquetas inferido del nombre del mando. */
  selectedLayoutKind: GamepadLayoutKind;
  /** Layout persistido por el usuario (`null` = automático por detección). */
  preferredLayoutKind: GamepadLayoutKind | null;
  setPreferredLayoutKind: (layout: GamepadLayoutKind | null) => Promise<void>;
  loadErr: string | null;
  rumbleErr: string | null;
  rumbleBusy: boolean;
  driverInstallBusy: boolean;
  listRefreshing: boolean;
  refreshList: (opts?: { showLoading?: boolean }) => Promise<void>;
  triggerRumble: () => Promise<void>;
  installGamepadDriver: () => Promise<void>;
}

/**
 * Sesión de telemetría del mando (IPC + eventos Tauri) para la pantalla Ajustes → Mando.
 * Al montar inicia la sesión y listeners; al desmontar los limpia.
 */
export function useGamepadTester(): UseGamepadTesterResult {
  const isDesktop = isTauri();
  const isWindowsDesktop = useMemo(() => {
    if (!isDesktop || typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform?.toLowerCase();
    if (platform) return platform.includes("win");
    return navigator.userAgent.toLowerCase().includes("windows");
  }, [isDesktop]);

  const [gamepads, setGamepads] = useState<GamepadSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [latestState, setLatestState] = useState<GamepadStatePayload | null>(null);
  const [preferredLayoutKind, setPreferredLayoutKindState] = useState<GamepadLayoutKind | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rumbleBusy, setRumbleBusy] = useState(false);
  const [rumbleErr, setRumbleErr] = useState<string | null>(null);
  const [driverInstallBusy, setDriverInstallBusy] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);

  const refreshList = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (!isTauri()) return;
    if (opts?.showLoading) setListRefreshing(true);
    try {
      const list = await invoke<GamepadSummaryDto[]>("list_connected_gamepads");
      setGamepads(list ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (opts?.showLoading) setListRefreshing(false);
    }
  }, []);

  const triggerRumble = useCallback(async () => {
    if (!isTauri() || selectedId == null) return;
    setRumbleBusy(true);
    setRumbleErr(null);
    try {
      await invoke("gamepad_tester_trigger_rumble", { gamepadIndex: selectedId });
    } catch (e) {
      setRumbleErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRumbleBusy(false);
    }
  }, [selectedId]);

  const installGamepadDriver = useCallback(async () => {
    if (!isTauri()) return;
    setDriverInstallBusy(true);
    toastInfo(
      "Instalando driver de mandos",
      "Descargando el instalador oficial de Microsoft. Puede tardar unos segundos."
    );
    try {
      await invoke("gamepad_install_windows_runtime");
      toastSuccess(
        "Instalador iniciado",
        "Se abrió el instalador oficial de DirectX/XInput. Si aparece UAC, acepta la elevación."
      );
    } catch (e) {
      toastError("No se pudo iniciar la instalación", e instanceof Error ? e.message : String(e));
    } finally {
      setDriverInstallBusy(false);
    }
  }, []);

  const setPreferredLayoutKind = useCallback(async (layout: GamepadLayoutKind | null) => {
    if (!isTauri()) return;
    const next = layout ?? null;
    setPreferredLayoutKindState(next);
    try {
      await invoke("set_preferred_gamepad_layout", { layout: next });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let unlistenList: UnlistenFn | undefined;
    let unlistenState: UnlistenFn | undefined;
    let cancelled = false;

    void (async () => {
      try {
        await refreshList();
        const savedLayout = await invoke<string | null>("get_preferred_gamepad_layout");
        if (
          savedLayout === "xbox" ||
          savedLayout === "playstation" ||
          savedLayout === "nintendo" ||
          savedLayout === "generic"
        ) {
          setPreferredLayoutKindState(savedLayout);
        } else {
          setPreferredLayoutKindState(null);
        }
        await invoke("gamepad_tester_session_start");

        unlistenList = await listen<GamepadListChangedPayload>("gamepad_list_changed", (ev) => {
          setGamepads(ev.payload.gamepads ?? []);
        });

        unlistenState = await listen<GamepadStatePayload>("gamepad_state", (ev) => {
          setLatestState(ev.payload);
        });
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      void unlistenList?.();
      void unlistenState?.();
      void invoke("gamepad_tester_session_stop").catch(() => {});
    };
  }, [refreshList]);

  useEffect(() => {
    if (gamepads.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev != null && gamepads.some((g) => g.id === prev)) return prev;
      return gamepads[0].id;
    });
  }, [gamepads]);

  const selectedTelemetry = useMemo(() => {
    if (selectedId == null || !latestState?.gamepads) return null;
    return latestState.gamepads.find((g) => g.id === selectedId) ?? null;
  }, [latestState, selectedId]);

  const selectedGamepadName = useMemo(() => {
    if (selectedId == null) return null;
    return gamepads.find((g) => g.id === selectedId)?.name ?? null;
  }, [gamepads, selectedId]);

  const selectedLayoutKind = useMemo(() => inferGamepadLayoutKind(selectedGamepadName ?? ""), [selectedGamepadName]);

  const selectedKey = selectedId != null ? String(selectedId) : "";

  return {
    isDesktop,
    isWindowsDesktop,
    gamepads,
    selectedId,
    setSelectedId,
    selectedKey,
    selectedTelemetry,
    selectedGamepadName,
    selectedLayoutKind,
    preferredLayoutKind,
    setPreferredLayoutKind,
    loadErr,
    rumbleErr,
    rumbleBusy,
    driverInstallBusy,
    listRefreshing,
    refreshList,
    triggerRumble,
    installGamepadDriver,
  };
}
