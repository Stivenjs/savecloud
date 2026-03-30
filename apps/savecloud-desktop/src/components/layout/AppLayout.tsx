import { type ReactNode, startTransition } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import type { NavItem } from "@components/layout/Sidebar";
import { StaggeredMenu } from "@components/external/StaggeredMenu";
import { NotificationCenter } from "@components/layout/NotificationCenter";
import { useShellUiStore } from "@store/ShellUiStore";

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
  }));

export function AppLayout({ navItems, children }: AppLayoutProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isDark = resolvedTheme === "dark";
  const setSideMenuOpen = useShellUiStore((s) => s.setSideMenuOpen);

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
        headerActions={<NotificationCenter />}
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
    </div>
  );
}
