import { type ReactNode, startTransition, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import type { NavItem } from "@components/layout/Sidebar";
import { StaggeredMenu } from "@components/external/StaggeredMenu";
import { MenuGamesList } from "@components/layout/Menugameslist";
import { NotificationCenter } from "@components/layout/NotificationCenter";
import { TitleBar } from "@components/layout/TitleBar";
import { useShellUiStore } from "@store/ShellUiStore";
import { BigPictureConsoleTopRail } from "@features/big-picture/BigPictureConsoleTopRail";
import { UserBadge } from "@features/games/UserBadge";
import { CloudMembersLauncher } from "@features/friends/CloudMembersLauncher";
import { CloudStreamsLauncher } from "@features/friends/CloudStreamsLauncher";
import { prefetchProfileDrawer } from "@features/profile/profileDrawerPrefetch";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useGamification } from "@hooks/useGamification";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { featureFlags } from "@/constants/featureFlags";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import type { ConfiguredGame } from "@app-types/config";

const ProfileDrawer = lazy(() => import("@features/profile/ProfileDrawer").then((m) => ({ default: m.ProfileDrawer })));

/**
 * Props del componente {@link AppLayout}.
 */
interface AppLayoutProps {
  /** Ítems de navegación principal mostrados en el menú lateral. */
  navItems: NavItem[];
  /** Contenido de la página activa. */
  children: ReactNode;
  /**
   * Lista de juegos configurados para mostrar en la sección
   * de juegos del panel del menú. Opcional: si no se proporciona
   * la sección de juegos no se renderiza.
   */
  games?: readonly ConfiguredGame[];
  /**
   * Callback que se ejecuta al pulsar un juego en el panel del menú.
   * Recibe el `ConfiguredGame` seleccionado.
   */
  onMenuGameClick?: (game: ConfiguredGame) => void;
  /** Oculta la barra superior nativa de la app para vistas inmersivas. */
  hideTitleBar?: boolean;
}

/**
 * Convierte los ítems de navegación al formato esperado por `StaggeredMenu`,
 * marcando como deshabilitado el ítem que corresponde a la ruta activa.
 *
 * @param navItems - Ítems de navegación de la aplicación.
 * @param currentPath - Pathname actual de React Router.
 * @returns Array de ítems formateados para `StaggeredMenu`.
 */
const menuItemsFromNav = (navItems: NavItem[], currentPath: string) =>
  navItems.map((n) => ({
    id: n.id,
    label: n.label,
    ariaLabel: `Ir a ${n.label}`,
    link: n.id,
    disabled: currentPath === n.id,
    icon: n.icon,
  }));

/**
 * Layout principal de la aplicación.
 *
 * Renderiza:
 * - {@link TitleBar} fija en la parte superior.
 * - Contenido de página (`children`) con el padding correcto.
 * - {@link StaggeredMenu} lateral con navegación, lista de juegos (opcional),
 *   controles de usuario y toggle de tema.
 * - {@link ProfileDrawer} lazy con apertura controlada por el store global
 *   y por el badge de usuario.
 *
 * ### Integración de juegos en el menú
 *
 * Pasa `games` y `onMenuGameClick` para activar la sección de juegos dentro
 * del panel lateral. El componente {@link MenuGamesList} se encarga
 * internamente del filtrado con debounce y la carga de media en batch.
 *
 * @example
 * ```tsx
 * <AppLayout navItems={NAV_ITEMS} games={configuredGames} onMenuGameClick={handleGameNav}>
 *   <Outlet />
 * </AppLayout>
 * ```
 */
export function AppLayout({ navItems, children, games, onMenuGameClick, hideTitleBar = false }: AppLayoutProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isDark = resolvedTheme === "dark";
  const setSideMenuOpen = useShellUiStore((s) => s.setSideMenuOpen);

  const { config, loading: configLoading } = useConfig();
  const { activeProfile } = useProfileSession();
  const { data: gamification } = useGamification();

  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  const hasSyncConfig = hasUsableCloudConnection(cloudConfig);
  const { connectionStatus } = useLastSyncInfo(hasSyncConfig);

  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  // Funcionalidad experimental: se controla desde un flag centralizado.
  const showStreamsLauncher = featureFlags.experimentalCloudStreams;

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

  /** Con drawer abierto, B/atras debe cerrarlo antes que el router. */
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
   * Ignora la navegación si ya estamos en esa ruta.
   */
  const handleNavigation = (link: string) => {
    if (link === "/settings") {
      void openOrFocusSettingsWindow();
      return;
    }
    if (location.pathname === link) return;
    startTransition(() => {
      navigate(link);
    });
  };

  return (
    <div className="relative min-h-screen">
      {!hideTitleBar ? <TitleBar /> : null}

      <main
        className={`min-h-screen overflow-x-clip px-6 pb-6 ${
          hideTitleBar ? "pt-(--savecloud-bp-library-header-h)" : "pt-26"
        }`}>
        {children}
      </main>

      {hideTitleBar ? (
        <BigPictureConsoleTopRail
          hidden={profileDrawerOpen}
          profileAvatar={config?.profileAvatar}
          profileFrame={config?.profileFrame}
          onOpenProfile={() => setProfileDrawerOpen(true)}
          onIntentOpenProfile={prefetchProfileDrawer}
        />
      ) : null}

      <StaggeredMenu
        isFixed
        position="left"
        bigPictureMode={hideTitleBar}
        hideFloatingHeader={hideTitleBar}
        headerOffset={hideTitleBar ? 0 : 40}
        items={menuItemsFromNav(navItems, location.pathname)}
        displaySocials={true}
        displayItemNumbering
        menuButtonColor={isDark ? "#e4e4e7" : "#18181b"}
        openMenuButtonColor="#18181b"
        changeMenuColorOnOpen
        colors={["#18181b", "#27272a", "#3f3f46"]}
        accentColor="#6366f1"
        showLogo={false}
        closeOnClickAway
        onMenuOpen={() => setSideMenuOpen(true)}
        onMenuClose={() => setSideMenuOpen(false)}
        onItemClick={(item) => {
          if (!item.link) return;
          setTimeout(() => handleNavigation(item.link), 320);
        }}
        headerActions={
          hideTitleBar ? null : (
            <div className="flex items-center gap-4">
              <UserBadge
                userId={activeProfile?.localUserId || config?.userId}
                profileAvatar={config?.profileAvatar}
                profileFrame={config?.profileFrame}
                hasSyncConfig={hasSyncConfig}
                connectionStatus={connectionStatus}
                onOpenProfile={() => setProfileDrawerOpen(true)}
                onIntentOpenProfile={prefetchProfileDrawer}
              />
              {showStreamsLauncher ? <CloudStreamsLauncher /> : null}
              <CloudMembersLauncher />
              <NotificationCenter />
            </div>
          )
        }
        /**
         * Sección de juegos inyectada en el panel del menú.
         * Solo se renderiza si se pasan juegos al layout.
         * El separador visual (border-top) separa esta sección
         * de los ítems de navegación principales.
         */
        panelSection={
          games && games.length > 0 ? (
            <div
              style={{
                borderTop: "1px solid color-mix(in oklab, currentColor 12%, transparent)",
                paddingTop: "1.25rem",
                marginTop: "0.5rem",
              }}>
              <MenuGamesList
                games={games}
                bigPictureConsole={hideTitleBar}
                onGameClick={(game) => {
                  useShellUiStore.getState().requestCloseSideMenu();
                  onMenuGameClick?.(game);
                }}
              />
            </div>
          ) : undefined
        }
        panelFooter={
          hideTitleBar ? null : (
            <Button
              isIconOnly
              variant="flat"
              radius="md"
              color="default"
              size="lg"
              className="text-foreground"
              aria-label={isDark ? "Modo claro" : "Modo oscuro"}
              onPress={() => setTheme(isDark ? "light" : "dark")}>
              {isDark ? <Sun size={22} /> : <Moon size={22} />}
            </Button>
          )
        }
      />

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
    </div>
  );
}
