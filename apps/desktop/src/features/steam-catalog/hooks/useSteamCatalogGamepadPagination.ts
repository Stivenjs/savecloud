import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
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
  const { data: preferredLayout } = useQuery({
    queryKey: ["preferred-gamepad-layout"],
    queryFn: () => invoke<string | null>("get_preferred_gamepad_layout"),
    enabled: bigPictureConsole,
    staleTime: 5 * 60 * 1000,
  });

  const layoutKind: GamepadLayoutKind = useMemo(() => {
    if (
      preferredLayout === "playstation" ||
      preferredLayout === "nintendo" ||
      preferredLayout === "xbox" ||
      preferredLayout === "generic"
    ) {
      return preferredLayout;
    }
    return "xbox";
  }, [preferredLayout]);

  const triggerLabels = useMemo(() => {
    if (layoutKind === "playstation") return { left: "L2", right: "R2" };
    if (layoutKind === "nintendo") return { left: "ZL", right: "ZR" };
    return { left: "LT", right: "RT" };
  }, [layoutKind]);

  // TanStack Query con dynamic import: los SVGs de Kenney SOLO se cargan si bigPictureConsole es true
  const { data: triggerUrls } = useQuery({
    queryKey: ["gamepad-trigger-assets", layoutKind],
    queryFn: async () => {
      const { getKenneyGamepadAssetUrl, kenneyAnalogTriggerAssetId } = await import("@/lib/kenneyGamepadAssets");
      return {
        left: getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "left")),
        right: getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "right")),
      };
    },
    enabled: bigPictureConsole,
    staleTime: Infinity,
  });

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
