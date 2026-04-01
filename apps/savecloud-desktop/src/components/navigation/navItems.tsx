import { Gamepad2, History, Info, Library, Settings, Users } from "lucide-react";
import type { NavItem } from "@components/layout";

export const NAV_ITEMS: NavItem[] = [
  { id: "/", label: "Juegos", icon: <Gamepad2 size={18} /> },
  { id: "/catalog", label: "Catálogo Steam", icon: <Library size={18} /> },
  { id: "/friends", label: "Amigos", icon: <Users size={18} /> },
  { id: "/history", label: "Historial", icon: <History size={18} /> },
  { id: "/settings", label: "Configuración", icon: <Settings size={18} /> },
  { id: "/about", label: "Acerca de", icon: <Info size={18} /> },
];
