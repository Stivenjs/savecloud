import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Toaster } from "sileo";

const TOAST_TOP_OFFSET = 40;
const TOAST_RIGHT_OFFSET = 16;

/** Fondo del pill SVG (equivalente a dark:bg-default-100 / bg-background). */
const TOAST_THEME = {
  dark: {
    fill: "oklch(0.27 0.006 286)",
    styles: { description: "!text-default-400" },
  },
  light: {
    fill: "oklch(0.98 0.002 286)",
    styles: { description: "!text-default-600" },
  },
} as const;

/**
 * Contenedor global de toasts (Sileo), alineado con la config previa de HeroUI ToastProvider.
 */
export function SavecloudToaster() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const mode = !mounted ? "dark" : resolvedTheme === "light" ? "light" : "dark";
  const palette = TOAST_THEME[mode];

  return (
    <Toaster
      position="top-right"
      offset={{ top: TOAST_TOP_OFFSET, right: TOAST_RIGHT_OFFSET }}
      theme={mode}
      options={{
        fill: palette.fill,
        styles: palette.styles,
      }}
    />
  );
}
