import { lazy, Suspense, type ReactNode, ViewTransition } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { preloadGameDetailModule } from "@features/game-detail/gameDetailLazy";

const GamesPage = lazy(() => import("@features/games").then((m) => ({ default: m.GamesPage })));
const FriendsPage = lazy(() => import("@features/friends/FriendsPage").then((m) => ({ default: m.FriendsPage })));
const HistoryPage = lazy(() => import("@features/history/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import("@features/settings").then((m) => ({ default: m.SettingsPage })));
const GameDetailPage = lazy(() => preloadGameDetailModule().then((m) => ({ default: m.GameDetailPage })));
const PlaceholderPage = lazy(() =>
  import("@components/navigation/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage }))
);
const SteamCatalogPage = lazy(() =>
  import("@features/steam-catalog/pages/SteamCatalogPage").then((m) => ({ default: m.SteamCatalogPage }))
);

const PageLoader = () => (
  <div className="flex min-h-[40vh] items-center justify-center">
    <Spinner size="lg" color="primary" label="Cargando..." />
  </div>
);

function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "game-detail": "none", default: "page-slide" }}
      exit={{ "game-detail": "none", default: "page-slide" }}
      default="none">
      {children}
    </ViewTransition>
  );
}

export function AppRoutes() {
  const location = useLocation();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes key={location.pathname}>
        <Route
          path="/"
          element={
            <AnimatedPage>
              <GamesPage />
            </AnimatedPage>
          }
        />
        <Route
          path="/games/:gameId"
          element={
            <AnimatedPage>
              <GameDetailPage />
            </AnimatedPage>
          }
        />
        <Route
          path="/catalog"
          element={
            <AnimatedPage>
              <SteamCatalogPage />
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
              <PlaceholderPage />
            </AnimatedPage>
          }
        />
      </Routes>
    </Suspense>
  );
}
