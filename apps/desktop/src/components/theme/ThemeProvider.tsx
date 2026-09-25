import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

/**
 * Propiedades del contexto de tema devuelto por `useTheme()`.
 */
export interface UseThemeProps {
  /** Tema actual seleccionado ("light", "dark", "system"). */
  theme?: string;

  /** Función para cambiar el tema actual. */
  setTheme: (theme: string) => void;

  /** Tema forzado (opcional). */
  forcedTheme?: string;

  /** Tema resuelto activo ("light" o "dark"). */
  resolvedTheme?: "dark" | "light";

  /** Lista de temas disponibles. */
  themes: string[];

  /** Tema del sistema operativo ("dark" o "light"). */
  systemTheme?: "dark" | "light";
}

const ThemeContext = createContext<UseThemeProps>({
  setTheme: () => {},
  themes: ["light", "dark", "system"],
});

/**
 * Hook para consumir el estado del tema actual en componentes React.
 */
export const useTheme = () => useContext(ThemeContext);

/**
 * Propiedades para el componente `ThemeProvider`.
 */
export interface ThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  defaultTheme?: string;
  storageKey?: string;
  enableSystem?: boolean;
  forcedTheme?: string;
  enableColorScheme?: boolean;
}

/**
 * Proveedor de tema nativo para React 19.
 *
 * Evita la inyección de etiquetas `<script>` en el árbol JSX para prevenir
 * advertencias en consola en aplicaciones Renderizadas en el Cliente (Vite / React 19).
 */
export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "savecloud-theme",
  enableSystem = true,
  forcedTheme,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<string>(() => {
    if (forcedTheme) return forcedTheme;
    try {
      return localStorage.getItem(storageKey) || defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

  const getSystemTheme = useCallback((): "dark" | "light" => {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(getSystemTheme);

  const resolvedTheme = useMemo<"dark" | "light">((): "dark" | "light" => {
    const activeTheme = forcedTheme || theme;
    if (activeTheme === "system" && enableSystem) {
      return systemTheme;
    }
    return activeTheme === "light" ? "light" : "dark";
  }, [theme, forcedTheme, enableSystem, systemTheme]);

  const applyTheme = useCallback((resolved: "dark" | "light") => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme, applyTheme]);

  useEffect(() => {
    if (!enableSystem) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [enableSystem]);

  const setTheme = useCallback(
    (newTheme: string) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(storageKey, newTheme);
      } catch {}
    },
    [storageKey]
  );

  const value = useMemo<UseThemeProps>(
    () => ({
      theme: forcedTheme || theme,
      setTheme,
      forcedTheme,
      resolvedTheme,
      themes: enableSystem ? ["light", "dark", "system"] : ["light", "dark"],
      systemTheme,
    }),
    [theme, forcedTheme, setTheme, resolvedTheme, enableSystem, systemTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
