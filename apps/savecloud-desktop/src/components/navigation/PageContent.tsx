import { Gamepad2, History, Info, Settings, Users } from "lucide-react";
import type { NavItem } from "@components/layout";
import { GamesPage } from "@features/games";
import { FriendsPage } from "@features/friends/FriendsPage";
import { HistoryPage } from "@features/history/HistoryPage";
import { SettingsPage } from "@features/settings";
import { Routes, Route } from "react-router-dom";

export const NAV_ITEMS: NavItem[] = [
  { id: "/", label: "Juegos", icon: <Gamepad2 size={18} /> },
  { id: "/friends", label: "Amigos", icon: <Users size={18} /> },
  { id: "/history", label: "Historial", icon: <History size={18} /> },
  { id: "/settings", label: "Configuración", icon: <Settings size={18} /> },
  { id: "/about", label: "Acerca de", icon: <Info size={18} /> },
];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<GamesPage />} />
      <Route path="/friends" element={<FriendsPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route
        path="*"
        element={
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-default-500">Sección en desarrollo</p>
          </div>
        }
      />
    </Routes>
  );
}
