import { Gamepad2, History, Info, Settings, Users } from "lucide-react";
import type { NavItem } from "@components/layout";
import { GamesPage } from "@features/games";
import { FriendsPage } from "@features/friends/FriendsPage";
import { HistoryPage } from "@features/history/HistoryPage";
import { SettingsPage } from "@features/settings";
import { Routes, Route, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

export const NAV_ITEMS: NavItem[] = [
  { id: "/", label: "Juegos", icon: <Gamepad2 size={18} /> },
  { id: "/friends", label: "Amigos", icon: <Users size={18} /> },
  { id: "/history", label: "Historial", icon: <History size={18} /> },
  { id: "/settings", label: "Configuración", icon: <Settings size={18} /> },
  { id: "/about", label: "Acerca de", icon: <Info size={18} /> },
];

export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={pageTransition.initial}
      animate={pageTransition.animate}
      exit={pageTransition.exit}
      transition={pageTransition.transition}>
      {children}
    </motion.div>
  );
}

export function AppRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <AnimatedPage>
              <GamesPage />
            </AnimatedPage>
          }
        />
        <Route
          path="/friends"
          element={
            <AnimatedPage>
              <FriendsPage />
            </AnimatedPage>
          }
        />
        <Route
          path="/history"
          element={
            <AnimatedPage>
              <HistoryPage />
            </AnimatedPage>
          }
        />
        <Route
          path="/settings"
          element={
            <AnimatedPage>
              <SettingsPage />
            </AnimatedPage>
          }
        />

        <Route
          path="*"
          element={
            <AnimatedPage>
              <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-default-500">Sección en desarrollo</p>
              </div>
            </AnimatedPage>
          }
        />
      </Routes>
    </AnimatePresence>
  );
}
