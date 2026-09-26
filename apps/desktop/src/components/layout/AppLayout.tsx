import {
  type ReactNode,
  useCallback,
  startTransition,
  addTransitionType,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useShellUiStore } from "@store/ShellUiStore";
import { BigPictureConsoleTopRail } from "@features/big-picture/BigPictureConsoleTopRail";
import { prefetchProfileDrawer } from "@features/profile/profileDrawerPrefetch";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useGamification } from "@hooks/useGamification";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import { XboxSidebar } from "@components/layout/XboxSidebar";
import { XboxTopHeader } from "@components/layout/XboxTopHeader";
import type { ConfiguredGame } from "@app-types/config";
import type { NavItem } from "@components/layout/Sidebar";

import { MenuGamesList } from "@components/layout/Menugameslist";
import type { StaggeredMenuItem } from "@components/external/StaggeredMenu";

const ProfileDrawer = lazy(() => import("@features/profile/ProfileDrawer").then((m) => ({ default: m.ProfileDrawer })));
const CommandPaletteModal = lazy(() =>
  import("@components/layout/CommandPaletteModal").then((m) => ({ default: m.CommandPaletteModal }))
);
const StaggeredMenu = lazy(() =>
  import("@components/external/StaggeredMenu").then((m) => ({ default: m.StaggeredMenu }))
);

/**
 * Props del componente {@link AppLayout}.
 */
interface AppLayoutProps {
  /** Ítems de navegación principal. */
  navItems: NavItem[];
  /** Contenido de la página activa. */
  children: ReactNode;
  /** Lista de juegos configurados. */
  games?: readonly ConfiguredGame[];
  /** Callback al seleccionar un juego. */
  onMenuGameClick?: (game: ConfiguredGame) => void;
  /** Oculta la barra superior nativa para vistas inmersivas / Big Picture. */
  hideTitleBar?: boolean;
}

/**
 * Layout principal de SaveCloud con interfaz moderna estilo Xbox.
 *
 * Estructura:
 * - {@link XboxSidebar}: Rail vertical fijo a la izquierda (~68px) con avatar, navegación e integraciones rápidas.
 * - {@link XboxTopHeader}: Barra superior integrada con buscador central estilo Xbox y controles de ventana nativos.
 * - `main`: Contenido de la página con padding adaptado.
 * - {@link ProfileDrawer}: Drawer de perfil y estadísticas de usuario.
 * - {@link CommandPaletteModal}: Buscador rápido global activado con `Ctrl+K`.
 */
export function AppLayout({ navItems, games = [], onMenuGameClick, children, hideTitleBar = false }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const { config, loading: configLoading } = useConfig();
  const { activeProfile } = useProfileSession();
  const { data: gamification } = useGamification();

  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  const hasSyncConfig = hasUsableCloudConnection(cloudConfig);
  const { connectionStatus } = useLastSyncInfo(hasSyncConfig);

  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);

  useEffect(() => {
    let last = useShellUiStore.getState().profileOpenRequest;
    return useShellUiStore.subscribe((state) => {
      const n = state.profileOpenRequest;
      if (n > last) {
        last = n;
        setProfileDrawerOpen(true);
      }
    });
  }, []);

  useEffect(() => {
    let last = useShellUiStore.getState().profileToggleRequest;
    return useShellUiStore.subscribe((state) => {
      const n = state.profileToggleRequest;
      if (n > last) {
        last = n;
        setProfileDrawerOpen((open) => !open);
      }
    });
  }, []);

  /** Con drawer abierto, tecla atrás/B debe cerrarlo antes que el router. */
  useEffect(() => {
    if (!profileDrawerOpen) return;
    return useShellUiStore.getState().registerBackHandler(() => {
      setProfileDrawerOpen(false);
      return true;
    });
  }, [profileDrawerOpen]);

  useEffect(() => {
    if (configLoading || !config) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchProfileDrawer(), { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(() => prefetchProfileDrawer(), 400);
    return () => clearTimeout(t);
  }, [configLoading, config]);

  /**
   * Navega a una ruta usando `startTransition` para no bloquear la UI.
   */
  const handleNavigation = useCallback(
    (link: string) => {
      if (link === "/settings") {
        void openOrFocusSettingsWindow();
        return;
      }
      if (location.pathname === link) return;
      startTransition(() => {
        navigate(link);
      });
    },
    [location.pathname, navigate]
  );

  const staggeredMenuItems: StaggeredMenuItem[] = useMemo(() => {
    return navItems.map((item) => ({
      id: item.id,
      label: item.label,
      ariaLabel: item.label,
      link: item.id,
      icon: item.icon,
    }));
  }, [navItems]);

  const handleStaggeredItemClick = useCallback(
    (item: StaggeredMenuItem) => {
      handleNavigation(item.link);
    },
    [handleNavigation]
  );

  const canGoBack = location.pathname !== "/";
  const handleGoBack = useCallback(() => {
    const handled = useShellUiStore.getState().dispatchBackNavigation();
    if (!handled) {
      startTransition(() => {
        addTransitionType("game-detail");
        if (window.history.state && typeof window.history.state.idx === "number" && window.history.state.idx > 0) {
          navigate(-1);
        } else {
          navigate("/");
        }
      });
    }
  }, [navigate]);

  const handleOpenSearch = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  const handleOpenProfile = useCallback(() => {
    setProfileDrawerOpen(true);
  }, []);

  const isGameDetail = location.pathname.startsWith("/games/");
  const activeUserId = activeProfile?.localUserId || config?.userId;
  const libraryAmbientArtworkUrl = useShellUiStore((state) => state.libraryAmbientArtworkUrl);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {!hideTitleBar && location.pathname === "/" && libraryAmbientArtworkUrl ? (
        <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-0 h-dvh w-screen overflow-hidden">
          <img
            src={libraryAmbientArtworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 size-full scale-110 object-cover opacity-[0.3] ${
              config?.lowPerformanceMode ? "" : "blur-[36px]"
            }`}
          />
          <div className="absolute inset-0 bg-background/55" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_22%_0%,rgba(0,112,255,0.2),transparent_52%),radial-gradient(ellipse_at_78%_10%,rgba(194,116,72,0.14),transparent_48%)]" />
          <div className="absolute inset-0 bg-linear-to-b from-background/10 via-transparent to-background/65" />
          <div className="absolute inset-0 bg-linear-to-r from-background/20 via-transparent to-background/20" />
        </div>
      ) : null}
      {/* Barra lateral izquierda estilo Xbox */}
      {!hideTitleBar ? (
        <XboxSidebar
          currentPath={location.pathname}
          onNavigate={handleNavigation}
          userId={activeUserId}
          profileAvatar={config?.profileAvatar}
          profileFrame={config?.profileFrame}
          hasSyncConfig={hasSyncConfig}
          connectionStatus={connectionStatus}
          onOpenProfile={handleOpenProfile}
          onIntentOpenProfile={prefetchProfileDrawer}
        />
      ) : null}

      {/* Barra superior integrada (Buscador central, botón atrás y controles) */}
      {!hideTitleBar ? (
        <XboxTopHeader
          onOpenSearch={handleOpenSearch}
          canGoBack={canGoBack}
          onGoBack={handleGoBack}
          isCinematic={isGameDetail}
        />
      ) : (
        <BigPictureConsoleTopRail
          hidden={profileDrawerOpen}
          profileAvatar={config?.profileAvatar}
          profileFrame={config?.profileFrame}
          onOpenProfile={handleOpenProfile}
          onIntentOpenProfile={prefetchProfileDrawer}
        />
      )}

      {/* Menú escalonado con lista integrada de juegos para Modo Consola */}
      {hideTitleBar && (
        <Suspense fallback={null}>
          <StaggeredMenu
            isFixed
            position="left"
            bigPictureMode
            closeOnClickAway
            hideFloatingHeader
            items={staggeredMenuItems}
            onItemClick={handleStaggeredItemClick}
            panelSection={
              <MenuGamesList
                games={games}
                onGameClick={(game) => {
                  onMenuGameClick?.(game);
                  useShellUiStore.getState().requestCloseSideMenu();
                }}
                bigPictureConsole
              />
            }
          />
        </Suspense>
      )}

      {/* Contenido principal */}
      <main
        className={`relative z-10 min-h-screen overflow-x-clip transition-all duration-300 ${
          hideTitleBar ? "pt-(--savecloud-bp-library-header-h) px-6 pb-6" : "ml-17 pt-16 px-8 pb-8"
        }`}>
        {children}
      </main>

      {/* Drawer de perfil */}
      <Suspense fallback={null}>
        <ProfileDrawer
          isOpen={profileDrawerOpen}
          onClose={() => setProfileDrawerOpen(false)}
          config={config ?? null}
          gamification={gamification ?? null}
          hasSyncConfig={hasSyncConfig}
          connectionStatus={connectionStatus}
          bigPictureConsole={hideTitleBar}
          bpReserveGlobalTopChromeSlot={hideTitleBar && !profileDrawerOpen}
        />
      </Suspense>

      {/* Buscador global / Paleta de comandos */}
      {isCommandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPaletteModal isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
