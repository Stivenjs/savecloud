import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { Gamepad2, Moon, Sun } from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface SidebarProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ items, activeId, onSelect }: SidebarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <aside className="flex w-56 flex-col border-r border-default-200 bg-default-100">
      <div className="flex items-center justify-between border-b border-default-200 px-4 py-5">
        <div className="flex items-center gap-3">
          <Gamepad2 size={24} className="text-primary" aria-hidden />
          <span className="font-semibold text-foreground">SaveCloud</span>
        </div>
        {mounted && (
          <Button
            isIconOnly
            variant="light"
            radius="md"
            color="primary"
            size="sm"
            aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            onPress={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {items.map((item) => (
          <Button
            key={item.id}
            variant={activeId === item.id ? "flat" : "light"}
            color={activeId === item.id ? "primary" : "default"}
            className="justify-start"
            startContent={item.icon}
            onPress={() => onSelect(item.id)}>
            {item.label}
          </Button>
        ))}
      </nav>
    </aside>
  );
}
