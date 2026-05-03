import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useNavigationStore } from "@features/input/store";
import { useShellUiStore } from "@store/ShellUiStore";
import { toggleSettingsWindowFromBigPicture } from "@/windows/settingsWindow";
import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";
import { useProfileSession } from "@/hooks/useProfileSession";
import {
  getKenneyGamepadAssetUrl,
  kenneyFaceAssetId,
  kenneyModeAssetId,
  kenneyStartAssetId,
} from "@/lib/kenneyGamepadAssets";

function normalizeLayoutKind(value: string | undefined): GamepadLayoutKind {
  if (value === "playstation" || value === "nintendo" || value === "generic") return value;
  return "xbox";
}

interface HintItem {
  id: string;
  iconUrl?: string;
  label: string;
}

function Hint({
  item,
  onActivate,
  hintAriaAction,
}: {
  item: HintItem;
  onActivate?: () => void;
  /** Fragmento después de ":" en aria-label cuando el hint es pulsable. */
  hintAriaAction?: string;
}) {
  const inner = (
    <>
      {item.iconUrl ? (
        <img
          src={item.iconUrl}
          alt={onActivate ? "" : item.label}
          aria-hidden={onActivate ? true : undefined}
          className="h-9 w-9 rounded-full bg-black/50 p-[3px] object-contain ring-1 ring-white/20 pointer-events-none"
        />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-[14px]">{item.id}</span>
      )}
      <span>{item.label}</span>
    </>
  );

  if (onActivate) {
    const labelDetail = hintAriaAction ? `: ${hintAriaAction}` : "";
    return (
      <button
        type="button"
        onClick={onActivate}
        aria-label={`${item.label}${labelDetail}`}
        className="pointer-events-auto flex cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-2 text-left text-[19px] font-extrabold tracking-[0.08em] uppercase text-white outline-none tap-highlight-transparent drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)] transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/14 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:bg-white/20 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent">
        {inner}
      </button>
    );
  }

  return (
    <div className="flex select-none items-center gap-3 text-[19px] font-extrabold tracking-[0.08em] uppercase text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]">
      {inner}
    </div>
  );
}

export function BigPictureControlHints() {
  const { activeProfile } = useProfileSession();
  const [layoutKind, setLayoutKind] = useState<GamepadLayoutKind>("xbox");

  useEffect(() => {
    let cancelled = false;

    const loadPreferredLayout = async () => {
      if (!isTauri()) return;
      try {
        const savedLayout = await invoke<string | null>("get_preferred_gamepad_layout");
        if (cancelled) return;
        setLayoutKind(normalizeLayoutKind(savedLayout ?? undefined));
      } catch {
        if (cancelled) return;
        setLayoutKind("xbox");
      }
    };

    void loadPreferredLayout();
    return () => {
      cancelled = true;
    };
  }, [activeProfile?.id]);

  const rightHints = useMemo<HintItem[]>(() => {
    const optionsUrl = getKenneyGamepadAssetUrl(layoutKind, kenneyStartAssetId(layoutKind));
    const selectUrl = getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, "South"));
    const backUrl = getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, "East"));
    return [
      { id: "options", iconUrl: optionsUrl, label: "Opciones" },
      { id: "select", iconUrl: selectUrl, label: "Seleccionar" },
      { id: "back", iconUrl: backUrl, label: "Atrás" },
    ];
  }, [layoutKind]);

  const leftHints = useMemo<HintItem[]>(() => {
    const menuUrl = getKenneyGamepadAssetUrl(layoutKind, kenneyModeAssetId(layoutKind));
    return [{ id: "menu", iconUrl: menuUrl, label: "Menú" }];
  }, [layoutKind]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 bg-black/85 px-8 py-2.5 backdrop-blur-md"
      data-shell-menu-ignore-outside-close="">
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-12">
          {leftHints.map((item) => (
            <Hint
              key={item.id}
              item={item}
              onActivate={
                item.id === "menu" ? () => useShellUiStore.getState().requestStaggeredMenuToggle() : undefined
              }
              hintAriaAction={item.id === "menu" ? "abrir o cerrar menú lateral" : undefined}
            />
          ))}
        </div>
        <div className="flex items-center gap-12">
          {rightHints.map((item) => (
            <Hint
              key={item.id}
              item={item}
              onActivate={
                item.id === "options"
                  ? () => {
                      void toggleSettingsWindowFromBigPicture();
                    }
                  : item.id === "select"
                    ? () => {
                        useNavigationStore.getState().confirmFocusedNodeFromHud();
                      }
                    : item.id === "back"
                      ? () => {
                          useShellUiStore.getState().dispatchBackNavigation();
                        }
                      : undefined
              }
              hintAriaAction={
                item.id === "options"
                  ? "mostrar u ocultar ajustes"
                  : item.id === "select"
                    ? "activar la opción enfocada"
                    : item.id === "back"
                      ? "volver atrás o cerrar menú lateral"
                      : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
