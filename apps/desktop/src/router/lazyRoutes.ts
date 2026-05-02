import { lazy } from "react";
import { preloadGameDetailModule } from "@features/game-detail/gameDetailLazy";

export const GamesPage = lazy(() => import("@features/games").then((m) => ({ default: m.GamesPage })));

export const GameDetailPage = lazy(() => preloadGameDetailModule().then((m) => ({ default: m.GameDetailPage })));

export const LibrarySaveGraphPage = lazy(() =>
  import("@features/save-graph").then((m) => ({
    default: m.LibrarySaveGraphPage,
  }))
);

export const GameSaveGraphPage = lazy(() =>
  import("@features/save-graph").then((m) => ({
    default: m.GameSaveGraphPage,
  }))
);

export const SteamCatalogPage = lazy(() =>
  import("@features/steam-catalog/pages/SteamCatalogPage").then((m) => ({
    default: m.SteamCatalogPage,
  }))
);

export const FriendsPage = lazy(() =>
  import("@features/friends/FriendsPage").then((m) => ({ default: m.FriendsPage }))
);

export const StreamViewerPage = lazy(() =>
  import("@features/friends/StreamViewerPage").then((m) => ({ default: m.StreamViewerPage }))
);

export const HistoryPage = lazy(() =>
  import("@features/history/HistoryPage").then((m) => ({ default: m.HistoryPage }))
);

export const AboutPage = lazy(() => import("@features/about/AboutPage").then((m) => ({ default: m.AboutPage })));

export const PlaceholderPage = lazy(() =>
  import("@components/navigation/PlaceholderPage").then((m) => ({
    default: m.PlaceholderPage,
  }))
);
