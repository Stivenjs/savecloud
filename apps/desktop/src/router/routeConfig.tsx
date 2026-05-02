import {
  GamesPage,
  GameDetailPage,
  LibrarySaveGraphPage,
  GameSaveGraphPage,
  SteamCatalogPage,
  FriendsPage,
  StreamViewerPage,
  HistoryPage,
  AboutPage,
  PlaceholderPage,
} from "@router/lazyRoutes";

export interface RouteConfig {
  path: string;
  element: React.ReactElement;
}

export const routeConfig: RouteConfig[] = [
  { path: "/", element: <GamesPage /> },
  { path: "/games/:gameId", element: <GameDetailPage /> },
  { path: "/graph", element: <LibrarySaveGraphPage /> },
  { path: "/games/:gameId/graph", element: <GameSaveGraphPage /> },
  { path: "/catalog", element: <SteamCatalogPage /> },
  { path: "/friends", element: <FriendsPage /> },
  { path: "/stream-viewer", element: <StreamViewerPage /> },
  { path: "/history", element: <HistoryPage /> },
  { path: "/about", element: <AboutPage /> },
  { path: "*", element: <PlaceholderPage /> },
];
