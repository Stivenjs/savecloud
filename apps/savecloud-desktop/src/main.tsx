import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { AppErrorBoundary } from "@components/error/AppErrorBoundary";
import App from "./App";
import "./index.css";

/** Configuración del cliente de React Query */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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

/**
 * Verifica si la aplicación debe renderizarse en modo overlay
 * @returns `true` si el parámetro overlay=true está en la URL
 */
function isOverlayMode(): boolean {
  return new URLSearchParams(window.location.search).get("overlay") === "true";
}

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

/**
 * Renderiza la aplicación en modo overlay
 * Carga dinámicamente los estilos y componentes del overlay
 */
async function renderOverlayApp(): Promise<void> {
  try {
    await import("./overlay.css");

    const { OverlayApp } = await import("./pages/OverlayApp");

    const root = ReactDOM.createRoot(getRootElement());

    root.render(
      <OverlayWrapper>
        <OverlayApp />
      </OverlayWrapper>
    );
  } catch (error) {
    console.error("[Render] Error cargando aplicación overlay:", error);
    throw error;
  }
}

/**
 * Renderiza la aplicación principal
 */
function renderMainApp(): void {
  try {
    const root = ReactDOM.createRoot(getRootElement());

    root.render(
      <MainAppWrapper>
        <App />
      </MainAppWrapper>
    );
  } catch (error) {
    console.error("[Render] Error cargando aplicación principal:", error);
    throw error;
  }
}

/**
 * Punto de entrada principal de la aplicación
 * Determina qué modo de renderizado usar (overlay vs aplicación principal)
 */
async function bootstrap(): Promise<void> {
  try {
    if (isOverlayMode()) {
      await renderOverlayApp();
    } else {
      renderMainApp();
    }
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
