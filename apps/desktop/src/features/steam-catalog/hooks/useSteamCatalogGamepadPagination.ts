import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getKenneyGamepadAssetUrl, kenneyAnalogTriggerAssetId } from "@/lib/kenneyGamepadAssets";
import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";

interface UseSteamCatalogGamepadPaginationProps {
  bigPictureConsole: boolean;
  totalPages: number;
  setPage: (next: number | ((prev: number) => number)) => void;
}

export function useSteamCatalogGamepadPagination({
  bigPictureConsole,
  totalPages,
  setPage,
}: UseSteamCatalogGamepadPaginationProps) {
  const [layoutKind, setLayoutKind] = useState<GamepadLayoutKind>("xbox");

  useEffect(() => {
    if (!bigPictureConsole) return;
    let cancelled = false;
    const loadPreferredLayout = async () => {
      try {
        const savedLayout = await invoke<string | null>("get_preferred_gamepad_layout");
        if (cancelled) return;
        if (
          savedLayout === "playstation" ||
          savedLayout === "nintendo" ||
          savedLayout === "xbox" ||
          savedLayout === "generic"
        ) {
          setLayoutKind(savedLayout);
        }
      } catch {
        // Fallback
      }
    };
    void loadPreferredLayout();
    return () => {
      cancelled = true;
    };
  }, [bigPictureConsole]);

  const triggerLabels = useMemo(() => {
    if (layoutKind === "playstation") return { left: "L2", right: "R2" };
    if (layoutKind === "nintendo") return { left: "ZL", right: "ZR" };
    return { left: "LT", right: "RT" };
  }, [layoutKind]);

  const triggerUrls = useMemo(() => {
    const left = getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "left"));
    const right = getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "right"));
    return { left, right };
  }, [layoutKind]);

  useEffect(() => {
    if (!bigPictureConsole) return;

    const handlePageLeft = () => {
      setPage((prev) => Math.max(1, prev - 1));
    };
    const handlePageRight = () => {
      setPage((prev) => Math.min(totalPages, prev + 1));
    };

    window.addEventListener("gamepad_page_left", handlePageLeft);
    window.addEventListener("gamepad_page_right", handlePageRight);

    return () => {
      window.removeEventListener("gamepad_page_left", handlePageLeft);
      window.removeEventListener("gamepad_page_right", handlePageRight);
    };
  }, [bigPictureConsole, totalPages, setPage]);

  return {
    triggerLabels,
    triggerUrls,
  };
}
