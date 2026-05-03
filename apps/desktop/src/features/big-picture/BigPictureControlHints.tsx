import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
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

function Hint({ item }: { item: HintItem }) {
  return (
    <div className="flex items-center gap-3 text-[19px] font-extrabold tracking-[0.08em] uppercase text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]">
      {item.iconUrl ? (
        <img
          src={item.iconUrl}
          alt={item.label}
          className="h-9 w-9 rounded-full bg-black/50 p-[3px] object-contain ring-1 ring-white/20"
        />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-[14px]">{item.id}</span>
      )}
      <span>{item.label}</span>
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 bg-black/85 px-8 py-2.5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-12">
          {leftHints.map((item) => (
            <Hint key={item.id} item={item} />
          ))}
        </div>
        <div className="flex items-center gap-12">
          {rightHints.map((item) => (
            <Hint key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
