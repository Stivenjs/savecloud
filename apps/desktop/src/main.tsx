import React from "react";
import ReactDOM from "react-dom/client";
import "@lib/i18n";
import i18n from "@lib/i18n";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider } from "@heroui/react";
import { SavecloudToaster } from "@components/toast/SavecloudToaster";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppErrorBoundary } from "@components/error/AppErrorBoundary";
import { queryClient } from "@lib/queryClient";
import { useShellUiStore } from "@store/ShellUiStore";
import App from "@/App";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { WindowEntranceAnimation } from "@components/layout";
import { MotionConfig } from "framer-motion";
import { useEffect } from "react";
import { preloadHls } from "@utils/hls";
import "@/styles/index.css";

preloadHls();

/** Configuración del tema */
const THEME_CONFIG = {
  attribute: "class" as const,
  defaultTheme: "dark",
  storageKey: "savecloud-theme",
  enableSystem: true,
} as const;

type RenderMode =
  | "overlay"
  | "streamViewer"
  | "friendsWindow"
  | "settingsWindow"
  | "bigPictureWindow"
  | "streamingWindow"
  | "shutdownWindow"
  | "main";

/**
 * Obtiene el elemento root del DOM de forma segura
 * @throws {Error} Si el elemento root no existe
 * @returns El elemento root del DOM
 */
function getRootElement(): HTMLElement {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("No se encontró el elemento root en el DOM");
  }

  return rootElement;
}

/**
 * Componente wrapper para la aplicación en modo overlay
 */
function OverlayWrapper({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      <WindowEntranceAnimation>{children}</WindowEntranceAnimation>
    </HeroUIProvider>
  );
}

/**
 * Componente wrapper para la aplicación principal
 */
function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const lowPerf = useLowPerformanceMode();

  useEffect(() => {
    const el = document.documentElement;
    if (lowPerf) {
      el.classList.add("low-perf");
    } else {
      el.classList.remove("low-perf");
    }
  }, [lowPerf]);

  return (
    <HeroUIProvider disableAnimation={lowPerf}>
      <MotionConfig reducedMotion={lowPerf ? "always" : "user"}>
        <WindowEntranceAnimation lowPerf={lowPerf}>{children}</WindowEntranceAnimation>
      </MotionConfig>
    </HeroUIProvider>
  );
}

function MainAppWrapper({ children }: { children: React.ReactNode }) {
  return (
    <React.StrictMode>
      <ThemeProvider {...THEME_CONFIG}>
        <QueryClientProvider client={queryClient}>
          <AppErrorBoundary>
            <AppConfigProvider>
              <SavecloudToaster />
              {children}
            </AppConfigProvider>
          </AppErrorBoundary>
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

function detectRenderMode(): RenderMode {
  const params = new URLSearchParams(window.location.search);
  if (params.get("overlay") === "true") return "overlay";
  if (params.get("streamViewer") === "true") return "streamViewer";
  if (params.get("friendsWindow") === "true") return "friendsWindow";
  if (params.get("settingsWindow") === "true") return "settingsWindow";
  if (params.get("bigPictureWindow") === "true") return "bigPictureWindow";
  if (params.get("streamingWindow") === "true") return "streamingWindow";
  if (params.get("shutdownWindow") === "true") return "shutdownWindow";
  return "main";
}

/** Webview nueva: sin residuos de contadores IPC que disparan toggle al montar React. */
function resetShellUiForBigPictureWindowEntry(): void {
  useShellUiStore.setState({
    staggeredMenuToggleRequest: 0,
    sideMenuCloseRequest: 0,
    sideMenuOpen: false,
    profileToggleRequest: 0,
  });
}

/** Shell solo en la webview Big Picture (scrollbars tipo consola). */
function applyShellFlagsForRenderMode(mode: RenderMode): void {
  if (mode === "bigPictureWindow") {
    document.documentElement.classList.add("savecloud-big-picture");
  } else {
    document.documentElement.classList.remove("savecloud-big-picture");
  }
}

function renderWithRoot(content: React.ReactNode): void {
  const root = ReactDOM.createRoot(getRootElement());
  root.render(content);
}

async function renderMainWrapped(content: React.ReactNode): Promise<void> {
  renderWithRoot(<MainAppWrapper>{content}</MainAppWrapper>);
  await showMainWindow();
}

async function renderOverlayApp(): Promise<void> {
  await import("@styles/overlay.css");
  const { OverlayApp } = await import("./pages/OverlayApp");
  renderWithRoot(
    <OverlayWrapper>
      <OverlayApp />
    </OverlayWrapper>
  );
}

async function renderStreamViewerApp(): Promise<void> {
  const { StreamViewerPage } = await import("@features/friends/StreamViewerPage");
  await renderMainWrapped(<StreamViewerPage />);
}

async function renderFriendsWindowApp(): Promise<void> {
  const { FriendsWindowPage } = await import("@features/friends/FriendsWindowPage");
  await renderMainWrapped(<FriendsWindowPage />);
}

async function renderMainApp(): Promise<void> {
  await renderMainWrapped(<App />);
  await maybeOpenStartupBigPicture();
}

async function renderSettingsWindowApp(): Promise<void> {
  const { SettingsWindowPage } = await import("@features/settings/SettingsWindowPage");
  await renderMainWrapped(<SettingsWindowPage />);
}

async function renderBigPictureWindowApp(): Promise<void> {
  resetShellUiForBigPictureWindowEntry();
  const { BigPictureWindowPage } = await import("@features/big-picture/BigPictureWindowPage");
  await renderMainWrapped(<BigPictureWindowPage />);
}

async function renderStreamingWindowApp(): Promise<void> {
  const { StreamingWindowPage } = await import("@features/streaming/StreamingWindowPage");
  await renderMainWrapped(<StreamingWindowPage />);
}

async function renderShutdownWindowApp(): Promise<void> {
  const { ShutdownWindowPage } = await import("@features/shutdown/ShutdownWindowPage");
  await renderMainWrapped(<ShutdownWindowPage />);
}

/**
 * Muestra la ventana principal de la aplicación
 */
async function showMainWindow(): Promise<void> {
  const appWindow = getCurrentWindow();
  await appWindow.show();
}

async function maybeOpenStartupBigPicture(): Promise<void> {
  try {
    const cfg = await invoke<{ startupWindowMode?: string }>("get_config");
    if (cfg?.startupWindowMode !== "big_picture") return;
    const { openOrFocusBigPictureWindow } = await import("@/windows/bigPictureWindow");
    await openOrFocusBigPictureWindow();
  } catch {
    // Si falla lectura de config, seguimos con arranque normal.
  }
}

/**
 * Punto de entrada principal de la aplicación
 * Determina qué modo de renderizado usar (overlay vs aplicación principal)
 */
async function bootstrap(): Promise<void> {
  try {
    const mode = detectRenderMode();
    applyShellFlagsForRenderMode(mode);
    const renderByMode: Record<RenderMode, () => Promise<void>> = {
      overlay: renderOverlayApp,
      streamViewer: renderStreamViewerApp,
      friendsWindow: renderFriendsWindowApp,
      settingsWindow: renderSettingsWindowApp,
      bigPictureWindow: renderBigPictureWindowApp,
      streamingWindow: renderStreamingWindowApp,
      shutdownWindow: renderShutdownWindowApp,
      main: renderMainApp,
    };
    await renderByMode[mode]();
  } catch (error) {
    console.error("[Bootstrap] Error fatal inicializando la aplicación:", error);

    // Mostrar mensaje de error en el DOM como fallback
    const rootElement = document.getElementById("root");
    if (rootElement) {
      rootElement.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: system-ui, -apple-system, sans-serif;
          text-align: center;
          padding: 2rem;
          background: #0a0a0a;
          color: #fff;
        ">
          <h1 style="font-size: 2rem; margin-bottom: 1rem;">${i18n.t("errors.bootstrapTitle")}</h1>
          <p style="color: #888; margin-bottom: 2rem;">
            ${i18n.t("errors.bootstrapDesc")}
          </p>
          <button 
            onclick="window.location.reload()" 
            style="
              padding: 0.75rem 1.5rem;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 0.5rem;
              cursor: pointer;
              font-size: 1rem;
            "
          >
            ${i18n.t("common.reload")}
          </button>
        </div>
      `;
    }
  }
}

bootstrap();
