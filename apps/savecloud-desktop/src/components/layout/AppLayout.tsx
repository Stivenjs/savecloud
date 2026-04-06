import { type ReactNode, startTransition, lazy, Suspense, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import type { NavItem } from "@components/layout/Sidebar";
import { StaggeredMenu } from "@components/external/StaggeredMenu";
import { NotificationCenter } from "@components/layout/NotificationCenter";
import { useShellUiStore } from "@store/ShellUiStore";
import { UserBadge } from "@features/games/UserBadge";
import { prefetchProfileDrawer } from "@features/profile/profileDrawerPrefetch";
import { useConfig } from "@hooks/useConfig";
import { useGamification } from "@hooks/useGamification";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { hasUsableCloudConnection } from "@utils/cloudConnection";

const ProfileDrawer = lazy(() => import("@features/profile/ProfileDrawer").then((m) => ({ default: m.ProfileDrawer })));

interface AppLayoutProps {
  navItems: NavItem[];
  children: ReactNode;
}

const menuItemsFromNav = (navItems: NavItem[], currentPath: string) =>
  navItems.map((n) => ({
    id: n.id,
    label: n.label,
    ariaLabel: `Ir a ${n.label}`,
    link: n.id,
    disabled: currentPath === n.id,
    icon: n.icon,
  }));

export function AppLayout({ navItems, children }: AppLayoutProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isDark = resolvedTheme === "dark";
  const setSideMenuOpen = useShellUiStore((s) => s.setSideMenuOpen);

  const { config, loading: configLoading } = useConfig();
  const { data: gamification } = useGamification();

  const hasSyncConfig = hasUsableCloudConnection(config);

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
    if (configLoading || !config) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetchProfileDrawer(), { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(() => prefetchProfileDrawer(), 400);
    return () => clearTimeout(t);
  }, [configLoading, config]);

  const handleNavigation = (link: string) => {
    if (location.pathname === link) return;
    startTransition(() => {
      navigate(link);
    });
  };

  return (
    <div className="relative min-h-screen">
      <main className="min-h-screen overflow-auto pt-16 px-6 pb-6">{children}</main>

      <StaggeredMenu
        isFixed
        position="left"
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

          setTimeout(() => {
            handleNavigation(item.link);
          }, 320);
        }}
        headerActions={
          <div className="flex items-center gap-4">
            <UserBadge
              userId={config?.userId}
              profileAvatar={config?.profileAvatar}
              profileFrame={config?.profileFrame}
              hasSyncConfig={hasSyncConfig}
              connectionStatus={connectionStatus}
              onOpenProfile={() => setProfileDrawerOpen(true)}
              onIntentOpenProfile={prefetchProfileDrawer}
            />
            <NotificationCenter />
          </div>
        }
        panelFooter={
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
        />
      </Suspense>
    </div>
  );
}
