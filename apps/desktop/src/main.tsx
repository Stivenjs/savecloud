import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppErrorBoundary } from "@components/error/AppErrorBoundary";
import { queryClient } from "@lib/queryClient";
import { useShellUiStore } from "@store/ShellUiStore";
import App from "@/App";
import "@/styles/index.css";

/** Configuración del tema */
const THEME_CONFIG = {
  attribute: "class" as const,
  defaultTheme: "dark",
  storageKey: "savecloud-theme",
  enableSystem: true,
} as const;

/** Configuración de toasts */
const TOAST_CONFIG = {
  toastOffset: 40,
  placement: "top-right" as const,
  toastProps: { timeout: 3000 },
} as const;

type RenderMode = "overlay" | "streamViewer" | "friendsWindow" | "settingsWindow" | "bigPictureWindow" | "main";

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
const OverlayWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <HeroUIProvider>{children}</HeroUIProvider>
);

/**
 * Componente wrapper para la aplicación principal
 */
const MainAppWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.StrictMode>
    <ThemeProvider {...THEME_CONFIG}>
      <HeroUIProvider>
        <ToastProvider {...TOAST_CONFIG} />
        <QueryClientProvider client={queryClient}>
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </QueryClientProvider>
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);

function detectRenderMode(): RenderMode {
  const params = new URLSearchParams(window.location.search);
  if (params.get("overlay") === "true") return "overlay";
  if (params.get("streamViewer") === "true") return "streamViewer";
  if (params.get("friendsWindow") === "true") return "friendsWindow";
  if (params.get("settingsWindow") === "true") return "settingsWindow";
  if (params.get("bigPictureWindow") === "true") return "bigPictureWindow";
  return "main";
}

/** Webview nueva: sin residuos de contadores IPC que disparan toggle al montar React. */
function resetShellUiForBigPictureWindowEntry(): void {
  useShellUiStore.setState({
    staggeredMenuToggleRequest: 0,
    sideMenuCloseRequest: 0,
    sideMenuOpen: false,
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
          <h1 style="font-size: 2rem; margin-bottom: 1rem;">Error al cargar la aplicación</h1>
          <p style="color: #888; margin-bottom: 2rem;">
            Ha ocurrido un error inesperado. Por favor, recarga la página.
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
            Recargar
          </button>
        </div>
      `;
    }
  }
}

bootstrap();
