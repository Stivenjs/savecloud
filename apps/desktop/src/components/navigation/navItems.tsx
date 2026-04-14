import { Gamepad2, History, Info, Library, Settings, Users } from "lucide-react";
import type { NavItem } from "@components/layout";

export const NAV_ITEMS: NavItem[] = [
  { id: "/", label: "Biblioteca", icon: <Gamepad2 size={18} /> },
  { id: "/catalog", label: "Tienda", icon: <Library size={18} /> },
  { id: "/friends", label: "Social", icon: <Users size={18} /> },
  { id: "/history", label: "Actividad", icon: <History size={18} /> },
  { id: "/settings", label: "Ajustes", icon: <Settings size={18} /> },
  { id: "/about", label: "Información", icon: <Info size={18} /> },
];
