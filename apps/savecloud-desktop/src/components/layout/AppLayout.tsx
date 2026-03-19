import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import type { NavItem } from "@components/layout/Sidebar";
import { StaggeredMenu } from "@components/external/StaggeredMenu";

interface AppLayoutProps {
  navItems: NavItem[];
  activeNavId: string;
  onNavSelect: (id: string) => void;
  children: ReactNode;
}

const menuItemsFromNav = (navItems: NavItem[]) =>
  navItems.map((n) => ({
    id: n.id,
    label: n.label,
    ariaLabel: `Ir a ${n.label}`,
    link: "#",
  }));

export function AppLayout({ navItems, activeNavId: _activeNavId, onNavSelect, children }: AppLayoutProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";

  return (
    <div className="relative min-h-screen">
      <main className="min-h-screen overflow-auto pt-16 px-6 pb-6">{children}</main>
      <StaggeredMenu
        isFixed
        position="left"
        items={menuItemsFromNav(navItems)}
        displaySocials={true}
        displayItemNumbering
        menuButtonColor={isDark ? "#e4e4e7" : "#18181b"}
        openMenuButtonColor="#18181b"
        changeMenuColorOnOpen
        colors={["#18181b", "#27272a", "#3f3f46"]}
        accentColor="#6366f1"
        showLogo={false}
        closeOnClickAway
        onItemClick={(item) => item.id && onNavSelect(item.id)}
        panelFooter={
          mounted ? (
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
          ) : null
        }
      />
    </div>
  );
}
